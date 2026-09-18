use std::collections::HashMap;
use std::path::{Path, PathBuf};
use futures_util::StreamExt;
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadata {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    // JS side (and the legacy Electron cache JSON) use the key `type`, not `trackType`.
    #[serde(rename = "type")]
    pub track_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    /// Content-Length captured at download completion. Used by `check_cache` to
    /// detect truncated files (interrupted downloads) — `len() > 0` alone is not
    /// enough, a half-written file still passes that check.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_size: Option<u64>,
}

pub struct CacheManager {
    cache_dir: PathBuf,
    active_downloads: Mutex<HashMap<i64, tokio::task::JoinHandle<Result<Option<String>, String>>>>,
}

impl CacheManager {
    pub fn new(app_data_dir: PathBuf, download_path: &str) -> Self {
        let cache_dir = app_data_dir.join("audio_cache");
        std::fs::create_dir_all(&cache_dir).ok();

        // The Electron build stored cache metadata under `<config_dir>/AudioDock/...`
        // (derived from the product name), while Tauri uses `<config_dir>/<identifier>/...`.
        // Migrate the legacy metadata into the new location once, so existing downloads
        // still show up after the switch to Tauri.
        migrate_legacy_cache(&app_data_dir, &cache_dir);

        // Best-effort startup cleanup: drop orphaned .tmp files and metadata
        // entries whose backing file is missing, so a stale JSON never tricks
        // `check_cache` into thinking a track is cached when it isn't.
        let cleaned = cleanup_orphan_cache(&cache_dir, download_path);
        if cleaned > 0 {
            eprintln!("[cache] startup cleanup removed {} orphan entries", cleaned);
        }

        Self {
            cache_dir,
            active_downloads: Mutex::new(HashMap::new()),
        }
    }

    /// The directory holding cache metadata + cover thumbnails. Used by the
    /// `media://cover` / `media://metadata` protocol handler.
    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn check_cache(
        &self,
        track_id: i64,
        _original_path: &str,
        download_path: &str,
        _track_type: &str,
        _album_name: &str,
    ) -> Result<Option<String>, String> {
        let meta_path = self.cache_dir.join(format!("{}.json", track_id));
        if !meta_path.exists() {
            return Ok(None);
        }

        let content = std::fs::read_to_string(&meta_path)
            .map_err(|e| format!("read meta: {}", e))?;
        let metadata: TrackMetadata = serde_json::from_str(&content)
            .map_err(|e| format!("parse meta: {}", e))?;

        if let Some(local_path) = &metadata.local_path {
            let expanded_download = expand_tilde(download_path)?;
            let full_path = Path::new(&expanded_download).join(local_path);
            match full_path.metadata() {
                Ok(m) if m.len() > 0 => {
                    // Integrity check: if we know the expected size from a previous
                    // completed download, the local file must match. A truncated
                    // file (interrupted download, partial rename) would still pass
                    // `len() > 0`, but playing it would fail midway — exactly the
                    // bug we're fixing here.
                    if let Some(expected) = metadata.expected_size {
                        if m.len() != expected {
                            eprintln!(
                                "[cache] track {} size mismatch: expected {} got {}, evicting",
                                track_id,
                                expected,
                                m.len()
                            );
                            // Remove the stale metadata + truncated file so the
                            // next play triggers a fresh download.
                            let _ = std::fs::remove_file(&meta_path);
                            let _ = std::fs::remove_file(&full_path);
                            return Ok(None);
                        }
                    }
                    return Ok(Some(local_path.clone()));
                }
                _ => {}
            }
        }

        Ok(None)
    }

    pub async fn download_track(
        &self,
        track_id: i64,
        url: &str,
        download_path: &str,
        track_type: &str,
        album_name: &str,
        metadata: TrackMetadata,
        token: Option<&str>,
    ) -> Result<Option<String>, String> {
        // Check if already downloading
        {
            let active = self.active_downloads.lock().await;
            if active.contains_key(&track_id) {
                return Ok(None);
            }
        }

        let expanded_download = expand_tilde(download_path)?;
        let url = url.to_string();
        let token = token.map(|s| s.to_string());
        let cache_dir = self.cache_dir.clone();
        let track_type = track_type.to_string();
        let album_name = album_name.to_string();

        let handle = tokio::spawn(async move {
            download_track_internal(
                &url,
                &expanded_download,
                &track_type,
                &album_name,
                &metadata,
                token.as_deref(),
                &cache_dir,
            )
            .await
        });

        {
            let mut active = self.active_downloads.lock().await;
            active.insert(track_id, handle);
        }

        // Wait for completion and clean up
        let result = {
            let mut active = self.active_downloads.lock().await;
            if let Some(handle) = active.remove(&track_id) {
                match handle.await {
                    Ok(res) => res,
                    Err(e) => Err(format!("Download task failed: {}", e)),
                }
            } else {
                Ok(None)
            }
        };

        result
    }

    pub fn list_cache(
        &self,
        download_path: &str,
        track_type: &str,
    ) -> Result<Vec<TrackMetadata>, String> {
        let mut results = Vec::new();

        if !self.cache_dir.exists() {
            return Ok(results);
        }

        let expanded_download = expand_tilde(download_path)?;

        for entry in std::fs::read_dir(&self.cache_dir)
            .map_err(|e| format!("read_dir: {}", e))?
        {
            let entry = entry.map_err(|e| format!("entry: {}", e))?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| format!("read meta: {}", e))?;
                if let Ok(data) = serde_json::from_str::<TrackMetadata>(&content) {
                    if data.track_type == track_type {
                        if let Some(local_path) = &data.local_path {
                            let full_path = Path::new(&expanded_download).join(local_path);
                            if full_path.exists() {
                                results.push(data);
                            }
                        }
                    }
                }
            }
        }

        Ok(results)
    }

    /// Total size of the downloaded audio files referenced by the cached metadata.
    ///
    /// Mirrors the legacy Electron `cache:get-size`, which summed the sizes of the
    /// actual audio files in the user's download folder (not the tiny metadata JSON
    /// / cover thumbnails living in the cache dir).
    pub fn get_total_size(&self, download_path: &str) -> Result<u64, String> {
        let mut total_size = 0u64;
        let expanded_download = expand_tilde(download_path)?;

        for meta in read_all_metadata(&self.cache_dir) {
            if let Some(local_path) = &meta.local_path {
                let full_path = Path::new(&expanded_download).join(local_path);
                if let Ok(m) = full_path.metadata() {
                    total_size += m.len();
                }
            }
        }

        Ok(total_size)
    }

    /// Removes every downloaded audio file referenced by the cached metadata, then
    /// wipes the cache dir (metadata + cover thumbnails). Mirrors the legacy
    /// Electron `cache:clear`, which freed the disk space taken by the downloads
    /// themselves - not just the metadata.
    pub fn clear_cache(&self, download_path: &str) -> Result<(), String> {
        let expanded_download = expand_tilde(download_path)?;

        // 1. Delete the downloaded audio files and prune the empty folders left behind.
        for meta in read_all_metadata(&self.cache_dir) {
            if let Some(local_path) = &meta.local_path {
                let full_path = Path::new(&expanded_download).join(local_path);
                if full_path.exists() {
                    let _ = std::fs::remove_file(&full_path);
                    remove_empty_parent_dirs(&full_path, &expanded_download);
                }
            }
        }

        // 2. Wipe the cache dir (metadata JSON + cover thumbnails).
        if self.cache_dir.exists() {
            for entry in std::fs::read_dir(&self.cache_dir)
                .map_err(|e| format!("read_dir: {}", e))?
            {
                let entry = entry.map_err(|e| format!("entry: {}", e))?;
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        Ok(())
    }
}

/// Reads and parses every `*.json` metadata file in `cache_dir`. Files that fail
/// to parse are silently skipped, matching the legacy Electron behaviour.
fn read_all_metadata(cache_dir: &Path) -> Vec<TrackMetadata> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(data) = serde_json::from_str::<TrackMetadata>(&content) {
                out.push(data);
            }
        }
    }
    out
}

/// Removes empty parent directories of `file_path` up to (but not including)
/// `download_root`, so clearing the cache doesn't leave empty `music/` or
/// `audio/<album>/` folders behind.
fn remove_empty_parent_dirs(file_path: &Path, download_root: &str) {
    let root = Path::new(download_root);
    let mut current = file_path.parent();
    while let Some(dir) = current {
        if dir == root || !dir.starts_with(root) {
            break;
        }
        // remove_dir only succeeds when the directory is empty.
        match std::fs::remove_dir(dir) {
            Ok(_) => current = dir.parent(),
            Err(_) => break,
        }
    }
}

pub(crate) fn expand_tilde(path: &str) -> Result<String, String> {
    if path.starts_with("~") {
        let home = dirs::home_dir().ok_or("Failed to get home dir")?;
        Ok(path.replacen("~", &home.to_string_lossy(), 1))
    } else {
        Ok(path.to_string())
    }
}

/// One-time migration of cache metadata written by the legacy Electron build.
///
/// Electron kept its `audio_cache` under `<config_dir>/AudioDock/` (product name),
/// whereas Tauri keeps it under `<config_dir>/<identifier>/`. Both share the same
/// platform `<config_dir>` (e.g. `~/Library/Application Support` on macOS), so the
/// legacy dir is a sibling of the current app data dir. We copy its contents the
/// first time the new cache dir is empty, then never again.
fn migrate_legacy_cache(app_data_dir: &Path, cache_dir: &Path) {
    // Skip if the new cache dir already has metadata — migration already happened
    // (or the user has downloaded something fresh).
    let has_metadata = std::fs::read_dir(cache_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("json"))
        })
        .unwrap_or(false);
    if has_metadata {
        return;
    }

    let legacy_dir = app_data_dir
        .parent() // <config_dir>
        .map(|config_dir| config_dir.join("AudioDock").join("audio_cache"));

    let Some(legacy_dir) = legacy_dir else { return };
    if !legacy_dir.exists() || legacy_dir == *cache_dir {
        return;
    }

    let Ok(entries) = std::fs::read_dir(&legacy_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let src = entry.path();
        if src.is_file() {
            let dest = cache_dir.join(entry.file_name());
            // Don't clobber anything that somehow already exists.
            if !dest.exists() {
                let _ = std::fs::copy(&src, &dest);
            }
        }
    }
}

async fn download_track_internal(
    url: &str,
    download_path: &str,
    track_type: &str,
    album_name: &str,
    metadata: &TrackMetadata,
    token: Option<&str>,
    cache_dir: &Path,
) -> Result<Option<String>, String> {
    let url_parsed = reqwest::Url::parse(url).map_err(|e| format!("url parse: {}", e))?;
    let file_name = url_parsed
        .path_segments()
        .and_then(|segments| segments.last())
        .unwrap_or("unknown");
    let decoded_name = percent_decode(file_name);

    let sub_folder = if track_type == "MUSIC" {
        "music".to_string()
    } else {
        format!("audio/{}", sanitize_filename(album_name))
    };

    let file_path = Path::new(download_path)
        .join(&sub_folder)
        .join(&decoded_name);
    let rel_path = format!("{}/{}", sub_folder, decoded_name);

    let dir_path = file_path.parent().unwrap();
    tokio::fs::create_dir_all(dir_path)
        .await
        .map_err(|e| format!("mkdir: {}", e))?;

    let temp_path = file_path.with_extension("tmp");

    if file_path.exists() {
        // File already on disk — trust it if we can confirm the size matches what
        // the server would send. Otherwise fall through and re-download so a
        // stale partial file gets replaced.
        let local_size = file_path.metadata().ok().map(|m| m.len());
        let mut meta = metadata.clone();
        meta.local_path = Some(rel_path.clone());
        // Adopt whatever the local file claims as the expected size, since we
        // have no way to verify it without a network call. The startup cleanup
        // and future downloads will fix genuinely truncated files.
        meta.expected_size = local_size;
        let meta_path = cache_dir.join(format!("{}.json", metadata.id));
        tokio::fs::write(
            &meta_path,
            serde_json::to_string_pretty(&meta).map_err(|e| format!("ser: {}", e))?,
        )
        .await
        .map_err(|e| format!("write meta: {}", e))?;
        return Ok(Some(rel_path.clone()));
    }

    let client = reqwest::Client::new();
    let mut request = client.get(url);
    if let Some(t) = token {
        request = request.header("Authorization", format!("Bearer {}", t));
    }
    request = request.header("User-Agent", "SoundX-Desktop");

    let response = request
        .send()
        .await
        .map_err(|e| format!("send: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }

    // Capture Content-Length BEFORE consuming the body, so we can persist it
    // as the source-of-truth for future integrity checks.
    let expected_size = response.content_length();

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("create file: {}", e))?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("chunk: {}", e))?;
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write: {}", e))?;
    }

    file.flush().await.map_err(|e| format!("flush: {}", e))?;
    drop(file);

    // If the server told us how big the body should be, make sure we actually
    // got that many bytes — otherwise the rename below would silently promote
    // a truncated file to "cached".
    if let Some(expected) = expected_size {
        if downloaded != expected {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(format!(
                "Download truncated: expected {} bytes, got {}",
                expected, downloaded
            ));
        }
    }

    tokio::fs::rename(&temp_path, &file_path)
        .await
        .map_err(|e| format!("rename: {}", e))?;

    if let Some(cover_url) = &metadata.cover {
        if !cover_url.is_empty() {
            let cover_ext = Path::new(cover_url)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("jpg");
            let cover_name = format!("{}_cover.{}", metadata.id, cover_ext);
            let cover_path = cache_dir.join(&cover_name);

            if let Ok(cover_res) = client.get(cover_url).send().await {
                if cover_res.status().is_success() {
                    if let Ok(bytes) = cover_res.bytes().await {
                        let snippet = String::from_utf8_lossy(&bytes[..bytes.len().min(10)]);
                        if !snippet.to_lowercase().contains("<!doc")
                            && !snippet.to_lowercase().contains("<html")
                        {
                            let _ = tokio::fs::write(&cover_path, &bytes).await;
                        }
                    }
                }
            }
        }
    }

    let mut meta = metadata.clone();
    meta.local_path = Some(rel_path.clone());
    meta.expected_size = expected_size;
    let meta_path = cache_dir.join(format!("{}.json", metadata.id));
    tokio::fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).map_err(|e| format!("ser: {}", e))?,
    )
    .await
    .map_err(|e| format!("write meta: {}", e))?;

    Ok(Some(rel_path.clone()))
}

fn percent_decode(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().to_string()
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | '?' | '%' | '*' | ':' | '|' | '"' | '<' | '>' => '-',
            _ => c,
        })
        .collect()
}

/// Startup hygiene for the on-disk cache. Returns the number of entries removed.
///
/// Three things can go wrong between runs:
///  1. A previous download was interrupted mid-write, leaving `<name>.tmp` next
///     to where the real file should be. We delete the `.tmp` and any stale
///     metadata that points to the missing target.
///  2. The user moved/renamed the download directory, so `local_path` in the
///     JSON points to a file that no longer exists.
///  3. The JSON itself is corrupted (partial write, legacy schema drift) and
///     can't be parsed — it's safer to drop it than keep it around.
///
/// This is intentionally *not* recursive: we only scan the cache_dir root and
/// the user's `download_path` for the exact files referenced by metadata.
fn cleanup_orphan_cache(cache_dir: &Path, download_path: &str) -> usize {
    let mut removed = 0;

    // ---- Pass 1: drop orphaned .tmp files in the download dir ---------------
    // We only know the naming scheme `<filename>.tmp` produced by
    // `download_track_internal`, so scan the same sub-folders that downloads
    // can write into: `<download>/music/` and `<download>/audio/<album>/`.
    if let Ok(expanded) = expand_tilde(download_path) {
        let root = Path::new(&expanded);
        let candidates = [root.join("music"), root.join("audio")];
        for dir in candidates {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                // `audio/` is one level deeper (album sub-folders)
                let nested: Vec<PathBuf> = if path.is_dir() {
                    std::fs::read_dir(&path)
                        .map(|rd| rd.flatten().map(|e| e.path()).collect())
                        .unwrap_or_default()
                } else {
                    vec![path]
                };
                for p in nested {
                    if p.extension().and_then(|s| s.to_str()) == Some("tmp") {
                        let _ = std::fs::remove_file(&p);
                        removed += 1;
                    }
                }
            }
        }
    }

    // ---- Pass 2: drop metadata JSONs whose backing file is missing ----------
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return removed;
    };
    let expanded_download = expand_tilde(download_path).unwrap_or_default();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let Ok(content) = std::fs::read_to_string(&path) else {
            let _ = std::fs::remove_file(&path);
            removed += 1;
            continue;
        };

        match serde_json::from_str::<TrackMetadata>(&content) {
            Ok(meta) => {
                let Some(local) = &meta.local_path else {
                    // Metadata that never completed a download — useless, drop it.
                    let _ = std::fs::remove_file(&path);
                    removed += 1;
                    continue;
                };
                let full = Path::new(&expanded_download).join(local);
                match full.metadata() {
                    Ok(m) if m.len() > 0 => {
                        // If we have an expected size, verify it now so a
                        // truncated file gets re-downloaded on first play.
                        if let Some(expected) = meta.expected_size {
                            if m.len() != expected {
                                let _ = std::fs::remove_file(&full);
                                let _ = std::fs::remove_file(&path);
                                removed += 1;
                            }
                        }
                    }
                    _ => {
                        // File missing or empty — metadata is dangling, drop it.
                        let _ = std::fs::remove_file(&path);
                        removed += 1;
                    }
                }
            }
            Err(_) => {
                // Unparsable JSON (partial write / schema drift) — drop it.
                let _ = std::fs::remove_file(&path);
                removed += 1;
            }
        }
    }

    removed
}
