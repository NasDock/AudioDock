import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as iconv from 'iconv-lite';
import * as music from 'music-metadata';
import * as path from 'path';
import { spawn } from 'child_process';
import { createClient, FileStat, WebDAVClient } from 'webdav';

function isGarbled(str: string): boolean {
  if (!str) return false;
  // Check for control characters (except tab, newline, carriage return)
  const controlChars = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f]/;
  if (controlChars.test(str)) return true;

  // Check for "REPLACEMENT CHARACTER" (U+FFFD)
  if (str.includes('\uFFFD')) return true;

  // Common mojibake when GBK metadata bytes are interpreted as Latin-1/Windows-1252.
  if (looksLikeLatin1Mojibake(str)) return true;

  return false;
}

function looksLikeLatin1Mojibake(str: string): boolean {
  if (!str) return false;

  const suspiciousChars = str.match(/[\u00A0-\u00FF]/g)?.length || 0;
  if (suspiciousChars < 2) return false;

  const decoded = decodeLatin1AsGbk(str);
  return hasCjk(decoded) && scoreDecodedText(decoded) > scoreDecodedText(str);
}

function decodeLatin1AsGbk(str: string): string {
  const buf = iconv.encode(str, 'latin1');
  return iconv.decode(buf, 'gbk');
}

function hasCjk(str: string): boolean {
  return /[\u3400-\u9fff]/.test(str);
}

function scoreDecodedText(str: string): number {
  let score = 0;
  for (const char of str) {
    if (/[\u3400-\u9fff]/.test(char)) score += 3;
    else if (/[\w\s()[\].,_-]/.test(char)) score += 1;
    else if (/[\u00A0-\u00FF]/.test(char)) score -= 1;
    else score -= 0.5;
  }
  return score;
}

export function readLyricsFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);

  // Try UTF-8 first
  let content = iconv.decode(buffer, 'utf-8');
  if (!isGarbled(content)) {
    return content;
  }

  // Fallback to GBK
  try {
    const decoded = iconv.decode(buffer, 'gbk');
    if (!isGarbled(decoded)) {
      return decoded;
    }
  } catch {
    // Ignore
  }

  return content;
}

export interface ScanResult {
  path: string;
  size: number;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  duration?: number;
  coverPath?: string;
  lyrics?: string;
  mtime: Date;
  [key: string]: any;
}

/**
 * 扫描预检钩子：在 parseFile 之前调用，返回 true 表示该文件无需处理
 *（例如 mtime 未变化），直接跳过解析与回调。调用方需自行将其计入已处理集合。
 */
export type ScanSkipPredicate = (filePath: string, stat: fs.Stats) => boolean;

export interface ScanOptions {
  audioOnly?: boolean;
  shouldSkip?: ScanSkipPredicate;
}

export class LocalMusicScanner {
  constructor(private cacheDir: string) {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  private isIgnoredPath(targetPath: string): boolean {
    const transcodedMvDir = path.join(this.cacheDir, 'transcoded-mv');
    return targetPath.startsWith(transcodedMvDir);
  }

  async scanMusic(dir: string, onFile?: (result: ScanResult) => Promise<void>, options?: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    if (!fs.existsSync(dir)) return results;

    await this.traverse(dir, async (filePath) => {
      const metadata = await this.parseFile(filePath);
      if (metadata) {
        if (onFile) {
          await onFile(metadata);
        }
        results.push(metadata);
      }
    }, { audioOnly: true, shouldSkip: options?.shouldSkip });
    return results;
  }

  async scanMv(dir: string, onFile?: (result: ScanResult) => Promise<void>): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    if (!fs.existsSync(dir)) return results;

    await this.traverse(dir, async (filePath) => {
      const metadata = await this.parseFile(filePath);
      if (metadata) {
        if (onFile) {
          await onFile(metadata);
        }
        results.push(metadata);
      }
    });
    return results;
  }

  async scanAudiobook(dir: string, onFile?: (result: ScanResult) => Promise<void>, options?: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    if (!fs.existsSync(dir)) return results;

    await this.traverse(dir, async (filePath) => {
      const metadata = await this.parseFile(filePath);
      if (metadata) {
        // 优先使用元信息中的 album，如果没有才使用文件夹名
        const parentDir = path.dirname(filePath);
        const folderName = path.basename(parentDir);
        if (this.isMissingAudiobookContributor(metadata.album)) {
          metadata.album = folderName;
        }
        if (this.isMissingAudiobookContributor(metadata.artist)) {
          metadata.artist = folderName;
        }
        if (this.isMissingAudiobookContributor(metadata.albumArtist)) {
          metadata.albumArtist = metadata.artist;
        }

        // If no cover, look for first image in directory
        if (!metadata.coverPath) {
          const coverPath = await this.findCoverInDirectory(parentDir);
          if (coverPath) {
            metadata.coverPath = coverPath;
          }
        }

        if (onFile) {
          await onFile(metadata);
        }
        results.push(metadata);
      }
    }, { audioOnly: true, shouldSkip: options?.shouldSkip });
    return results;
  }

  async countFiles(dir: string, options?: { audioOnly?: boolean }): Promise<number> {
    let count = 0;
    if (!fs.existsSync(dir)) return 0;
    const extensionPattern = options?.audioOnly ? this.AUDIO_EXTENSIONS : this.ALL_MEDIA_EXTENSIONS;

    const traverseCount = (currentDir: string) => {
      try {
        const files = fs.readdirSync(currentDir);
        for (const file of files) {
          const fullPath = path.join(currentDir, file);
          if (this.isIgnoredPath(fullPath)) {
            continue;
          }
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              traverseCount(fullPath);
            } else if (extensionPattern.test(file)) {
              count++;
            }
          } catch (e) {
            console.warn(`Skipping file ${fullPath}: ${e}`);
          }
        }
      } catch (e) {
        console.warn(`Failed to read dir ${currentDir}: ${e}`);
      }
    };

    traverseCount(dir);
    return count;
  }

  private readonly AUDIO_EXTENSIONS = /\.(mp3|flac|ogg|wav|m4a|strm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i;
  private readonly VIDEO_EXTENSIONS = /\.(mp4|mkv|avi|webm)$/i;
  private readonly ALL_MEDIA_EXTENSIONS = /\.(mp3|flac|ogg|wav|m4a|mp4|strm|mkv|avi|webm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i;

  private async traverse(dir: string, callback: (path: string) => Promise<void>, options?: ScanOptions) {
    const extensionPattern = options?.audioOnly ? this.AUDIO_EXTENSIONS : this.ALL_MEDIA_EXTENSIONS;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (this.isIgnoredPath(fullPath)) {
          continue;
        }
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            await this.traverse(fullPath, callback, options);
          } else if (extensionPattern.test(file)) {
            // 预检命中（如 mtime 未变化）则跳过，避免昂贵的 parseFile
            if (options?.shouldSkip && options.shouldSkip(fullPath, stat)) {
              continue;
            }
            await callback(fullPath);
          }
        } catch (e) {
          console.warn(`Skipping file ${fullPath}: ${e}`);
        }
      }
    } catch (e) {
      console.warn(`Failed to read dir ${dir}: ${e}`);
    }
  }

  private async parseVideoFileWithFfprobe(filePath: string): Promise<ScanResult | null> {
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);

    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ]);

      let stdout = '';
      let stderr = '';

      ffprobe.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      ffprobe.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      ffprobe.on('error', (error) => {
        console.warn(`ffprobe unavailable for ${filePath}: ${String(error)}`);
        resolve(null);
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          console.warn(`ffprobe failed for ${filePath}: ${stderr || `exit code ${code}`}`);
          resolve(null);
          return;
        }

        try {
          const parsed = JSON.parse(stdout || '{}');
          const format = parsed?.format || {};
          const formatTags = format?.tags || {};
          const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
          const videoStream = streams.find((stream: any) => stream?.codec_type === 'video') || null;
          const videoTags = videoStream?.tags || {};

          const pickTag = (...values: Array<string | undefined>) =>
            values.find((value) => typeof value === 'string' && value.trim())?.trim();

          let title = pickTag(
            formatTags.title,
            videoTags.title,
          ) || path.basename(filePath, ext);
          let artist = pickTag(
            formatTags.artist,
            formatTags.ARTIST,
            videoTags.artist,
            videoTags.ARTIST,
          ) || '未知';
          let album = pickTag(
            formatTags.album,
            formatTags.ALBUM,
            videoTags.album,
            videoTags.ALBUM,
          ) || '未知';
          let albumArtist = pickTag(
            formatTags.album_artist,
            formatTags.albumartist,
            formatTags.ALBUM_ARTIST,
            formatTags.ALBUMARTIST,
            videoTags.album_artist,
            videoTags.albumartist,
          );

          title = this.fixEncoding(title);
          artist = this.fixEncoding(artist);
          album = this.fixEncoding(album);
          albumArtist = albumArtist ? this.fixEncoding(albumArtist) : undefined;

          if (!title || this.isGarbled(title)) {
            title = path.basename(filePath, ext);
          }

          const duration = Number(format?.duration || videoStream?.duration || 0) || 0;

          resolve({
            path: filePath,
            originalPath: filePath,
            size: stat.size,
            mtime: stat.mtime,
            title,
            artist,
            album,
            albumArtist,
            duration,
          });
        } catch (error) {
          console.warn(`Failed to parse ffprobe output for ${filePath}: ${String(error)}`);
          resolve(null);
        }
      });
    });
  }

  public async parseFile(filePath: string): Promise<ScanResult | null> {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const isVideoFile = /\.(mp4|mkv|avi|webm)$/i.test(ext);
      
      // Handle .strm files
      if (ext === '.strm') {
        let url = fs.readFileSync(filePath, 'utf-8').trim();
        if (!url) return null;

        // Resolve relative paths using STRM_ADDRESS
        if (!url.startsWith('http')) {
          const base = process.env.STRM_ADDRESS || '';
          // Ensure no double slashes if base ends with / or url starts with /
          const separator = (base.endsWith('/') || url.startsWith('/')) ? '' : '/';
          url = `${base}${separator}${url}`;
        }

        const scanResult: ScanResult = {
          path: encodeURI(decodeURI(url)),
          originalPath: filePath,
          size: fs.statSync(filePath).size,
          mtime: fs.statSync(filePath).mtime,
          title: path.basename(filePath, '.strm'),
          artist: '未知',
          album: '未知',
          duration: 0,
        };

        // Try to fetch remote metadata
        try {
          const remoteMetadata = await this.parseRemoteFile(url);
          if (remoteMetadata) {
            if (remoteMetadata.common.title) scanResult.title = remoteMetadata.common.title;
            if (remoteMetadata.common.artist) scanResult.artist = remoteMetadata.common.artist;
            if (remoteMetadata.common.album) scanResult.album = remoteMetadata.common.album;
            if (remoteMetadata.format.duration) scanResult.duration = remoteMetadata.format.duration;
            
            // Handle cover if present in remote metadata
            if (remoteMetadata.common.picture && remoteMetadata.common.picture.length > 0) {
              const picture = remoteMetadata.common.picture[0];
              const picExt = picture.format.split('/')[1] || 'jpg';
              const fileName = path.basename(filePath);
              const coverName = `${fileName}_strm.${picExt}`;
              const savePath = path.join(this.cacheDir, coverName);
              fs.writeFileSync(savePath, picture.data);
              scanResult.coverPath = savePath;
            }
          }
        } catch (e: any) {
          console.warn(`Failed to fetch remote metadata for ${url}: ${e.message}`);
        }

        return scanResult;
      }

      if (isVideoFile) {
        const videoMetadata = await this.parseVideoFileWithFfprobe(filePath);
        if (videoMetadata) {
          return videoMetadata;
        }
      }

      let metadata: any;
      try {
        metadata = await music.parseFile(filePath);
      } catch (err) {
        if (isVideoFile) {
          // Fallback for video files that music-metadata might not support
          return {
            path: filePath,
            originalPath: filePath,
            size: fs.statSync(filePath).size,
            mtime: fs.statSync(filePath).mtime,
            title: path.basename(filePath, ext),
            artist: '未知',
            album: '未知',
            duration: 0,
          };
        }
        // Fallback: if extension mismatch (e.g. .flac but actually MP3),
        // read buffer and let music-metadata auto-detect format from content.
        try {
          const buffer = fs.readFileSync(filePath);
          metadata = await music.parseBuffer(buffer);
        } catch (bufferErr) {
          throw err;
        }
      }

      const common = metadata.common;

      let coverPath = null;
      if (common.picture && common.picture.length > 0) {
        const picture = common.picture[0];
        const ext = picture.format.split('/')[1] || 'jpg';
        const fileName = path.basename(filePath);
        const dirName = path.basename(path.dirname(filePath));
        // Cover name includes parent directory to avoid conflicts
        const coverName = `${dirName}_${fileName}.${ext}`;
        const savePath = path.join(this.cacheDir, coverName);

        fs.writeFileSync(savePath, picture.data);
        coverPath = savePath;
      }

      // Extract lyrics from metadata or file
      let lyrics = null;
      if (common.lyrics && common.lyrics.length > 0) {
        // lyrics can be string[] or string
        lyrics = Array.isArray(common.lyrics) ? common.lyrics.join('\n') : common.lyrics;
      } else {
        // Try to find lyrics in native tags (e.g., USLT in ID3v2)
        if (metadata.native && metadata.native['ID3v2.3']) {
          const uslt = metadata.native['ID3v2.3'].find((tag: any) => tag.id === 'USLT');
          if (uslt && uslt.value && uslt.value.text) {
            lyrics = uslt.value.text;
          }
        }

        // Also check ID3v2.4 just in case
        if (!lyrics && metadata.native && metadata.native['ID3v2.4']) {
          const uslt = metadata.native['ID3v2.4'].find((tag: any) => tag.id === 'USLT');
          if (uslt && uslt.value && uslt.value.text) {
            lyrics = uslt.value.text;
          }
        }

        // If still no lyrics, look for lyrics file in the same directory
        if (!lyrics) {
          lyrics = await this.findLyricsFile(filePath);
        }
      }

      // Sanitize lyrics (remove null bytes)
      if (lyrics) {
        lyrics = lyrics.replace(/\u0000/g, '');
      }

      // 优先从 ID3v2.4/ID3v2.3 读取标签，避免 APEv2 等标签污染
      let title: string | undefined = undefined;
      let artist: string | undefined = undefined;
      let album: string | undefined = undefined;
      let hasId3v2Title = false;

      // 尝试从 ID3v2.4 获取
      if (metadata.native && metadata.native['ID3v2.4']) {
        const id3v24 = metadata.native['ID3v2.4'];
        const tit2 = id3v24.find((tag: any) => tag.id === 'TIT2');
        const tpe1 = id3v24.find((tag: any) => tag.id === 'TPE1');
        const talb = id3v24.find((tag: any) => tag.id === 'TALB');
        if (tit2 && tit2.value) {
          title = tit2.value;
          hasId3v2Title = true;
        }
        if (tpe1 && tpe1.value) artist = tpe1.value;
        if (talb && talb.value) album = talb.value;
      }

      // 如果 ID3v2.4 没有，尝试从 ID3v2.3 获取
      if ((!title || !artist || !album) && metadata.native && metadata.native['ID3v2.3']) {
        const id3v23 = metadata.native['ID3v2.3'];
        if (!title) {
          const tit2 = id3v23.find((tag: any) => tag.id === 'TIT2');
          if (tit2 && tit2.value) {
            title = tit2.value;
            hasId3v2Title = true;
          }
        }
        if (!artist) {
          const tpe1 = id3v23.find((tag: any) => tag.id === 'TPE1');
          if (tpe1 && tpe1.value) artist = tpe1.value;
        }
        if (!album) {
          const talb = id3v23.find((tag: any) => tag.id === 'TALB');
          if (talb && talb.value) album = talb.value;
        }
      }

      // 如果 ID3v2 中没有 title，则回退到文件名（避免使用可能被 APEv2 污染的 common.title）
      if (!hasId3v2Title) {
        title = path.basename(filePath, path.extname(filePath));
      }

      // 如果 ID3v2 中没有 artist/album，回退到 common
      if (!artist) {
        artist = common.artist || common.album;
      }
      if (!album) {
        album = common.album;
      }

      // Fix encoding if garbled
      title = this.fixEncoding(title || '');
      artist = this.fixEncoding(artist || '');
      album = this.fixEncoding(album || '');

      // Fallback to filename if title is missing or still garbled
      if (!title || this.isGarbled(title)) {
        title = path.basename(filePath, path.extname(filePath));
      }

      return {
        path: filePath,
        originalPath: filePath,
        size: fs.statSync(filePath).size,
        mtime: fs.statSync(filePath).mtime,
        ...common,
        title,
        artist: artist || '未知',
        album: album || '未知',
        albumArtist: common.albumartist,
        duration: metadata.format.duration,
        coverPath: coverPath || undefined,
        lyrics: lyrics || undefined,
      };
    } catch (e) {
      console.error(`Failed to parse ${filePath}`, e);
      return null;
    }
  }

  public async findLyricsFile(audioFilePath: string): Promise<string | null> {
    const dir = path.dirname(audioFilePath);
    const baseName = path.basename(audioFilePath, path.extname(audioFilePath));

    // Try .lrc first, then .txt
    const lrcPath = path.join(dir, `${baseName}.lrc`);
    const txtPath = path.join(dir, `${baseName}.txt`);

    return readLyricsFile(lrcPath) || readLyricsFile(txtPath);
  }

  public async findCoverInDirectory(dir: string): Promise<string | null> {
    try {
      const files = fs.readdirSync(dir);
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (imageExtensions.includes(ext)) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);

          if (stat.isFile()) {
            // Copy to cache directory
            const cacheName = `${path.basename(dir)}_cover${ext}`;
            const cachePath = path.join(this.cacheDir, cacheName);
            fs.copyFileSync(fullPath, cachePath);
            return cachePath;
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to find cover in ${dir}:`, e);
    }

    return null;
  }

  private isGarbled(str: string): boolean {
    if (!str) return false;
    // Check for control characters (except tab, newline, carriage return)
    const controlChars = /[\u0000-\u0008\u000b-\u000c\u000e-\u001f\u007f]/;
    if (controlChars.test(str)) return true;

    // Check for "REPLACEMENT CHARACTER" (U+FFFD)
    if (str.includes('\uFFFD')) return true;

    if (looksLikeLatin1Mojibake(str)) return true;

    return false;
  }

  private isMissingAudiobookContributor(value?: string): boolean {
    const normalized = (value || '').trim();
    return !normalized || normalized === '未知' || this.isGarbled(normalized);
  }

  private fixEncoding(str: string): string {
    if (!str) return str;
    if (!this.isGarbled(str)) return str;

    try {
      // Try to convert back to buffer using ISO-8859-1 (raw bytes)
      // and then decode as GBK
      const decoded = decodeLatin1AsGbk(str);

      // If the decoded string doesn't look garbled, use it
      if (decoded && !this.isGarbled(decoded)) {
        return decoded;
      }
    } catch (e) {
      // Ignore
    }
    return str;
  }

  private async parseRemoteFile(url: string, redirectCount = 0): Promise<music.IAudioMetadata | null> {
    if (redirectCount > 5) return null;

    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const options = {
        timeout: 10000,
        headers: {
          'Range': 'bytes=0-1048576' // Request first 1MB to avoid downloading whole file
        }
      };
      
      const req = client.get(url, options, (res: http.IncomingMessage) => {
        // Handle transparency/redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          let location = res.headers.location;
          if (!location.startsWith('http')) {
            const parsed = new URL(url);
            location = `${parsed.protocol}//${parsed.host}${location}`;
          }
          return resolve(this.parseRemoteFile(location, redirectCount + 1));
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return resolve(null);
        }

        music.parseStream(res as any, { mimeType: res.headers['content-type'] }, { skipCovers: false })
          .then((metadata) => {
            req.destroy(); 
            resolve(metadata);
          })
          .catch((err: any) => {
            req.destroy();
            // Don't reject for metadata parsing errors, just log and return basic info
            console.warn(`Metadata parsing failed for ${url}: ${err.message}`);
            resolve(null);
          });
      });

      req.on('error', (err) => {
        resolve(null); // Resolve with null on connection error
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  }
}

export class WebDAVScanner {
  private client: WebDAVClient;

  constructor(
    private url: string,
    private user?: string,
    private password?: string,
    private cacheDir?: string
  ) {
    // Decode URI to prevent double encoding and trim trailing slash
    let decodedUrl = decodeURI(url);
    if (decodedUrl.endsWith('/')) {
      decodedUrl = decodedUrl.slice(0, -1);
    }
    
    console.log(`[WebDAVScanner] Initialized with URL: ${decodedUrl}`);
    
    this.client = createClient(decodedUrl, {
      username: user,
      password: password,
    });
    if (cacheDir && !fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  }

  public async count(remotePath: string = '/'): Promise<number> {
    let count = 0;
    try {
      const contents = await this.client.getDirectoryContents(remotePath) as FileStat[];
      for (const item of contents) {
        if (item.type === 'directory') {
          count += await this.count(item.filename);
        } else if (/\.(mp3|flac|ogg|wav|m4a|mp4|mkv|avi|webm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i.test(item.filename)) {
          count++;
        }
      }
    } catch (e) {
      console.error(`WebDAV count failed for ${remotePath}:`, e);
    }
    return count;
  }

  public async scan(remotePath: string = '/', callback: (item: ScanResult) => Promise<void>): Promise<void> {
    try {
      const contents = await this.client.getDirectoryContents(remotePath) as FileStat[];
      
      for (const item of contents) {
        if (item.type === 'directory') {
          await this.scan(item.filename, callback);
        } else if (/\.(mp3|flac|ogg|wav|m4a|mp4|mkv|avi|webm|aac|wma|opus|ape|aiff|aif|dsf|dff|wv|mpc|alac)$/i.test(item.filename)) {
          const result = await this.parseRemoteFile(item);
          if (result) {
            await callback(result);
          }
        }
      }
    } catch (e) {
      console.error(`WebDAV scan failed for ${remotePath}:`, e);
    }
  }

  private async parseRemoteFile(file: FileStat): Promise<ScanResult | null> {
    const streamUrl = this.client.getFileDownloadLink(file.filename);
    
    const result: ScanResult = {
      path: streamUrl,
      originalPath: file.filename,
      size: file.size,
      mtime: new Date(file.lastmod),
      title: path.basename(file.filename, path.extname(file.filename)),
      artist: '未知',
      album: '未知',
      duration: 0,
    };

    // Try to fetch metadata using the same stream logic as strm
    try {
        // Simple helper to fetch metadata from WebDAV stream
        const metadata = await this.fetchMetadata(streamUrl);
        if (metadata) {
            if (metadata.common.title) result.title = metadata.common.title;
            if (metadata.common.artist) result.artist = metadata.common.artist;
            if (metadata.common.album) result.album = metadata.common.album;
            if (metadata.common.albumartist) result.albumArtist = metadata.common.albumartist;
            if (metadata.format.duration) result.duration = metadata.format.duration;

            if (this.cacheDir && metadata.common.picture && metadata.common.picture.length > 0) {
                const picture = metadata.common.picture[0];
                const picExt = picture.format.split('/')[1] || 'jpg';
                const coverName = `${Buffer.from(file.filename).toString('hex').slice(-20)}_${picExt}`;
                const savePath = path.join(this.cacheDir, coverName);
                fs.writeFileSync(savePath, picture.data);
                result.coverPath = savePath;
            }
        }
    } catch (e) {
        console.warn(`Failed to fetch WebDAV metadata for ${file.filename}`);
    }

    return result;
  }

  private async fetchMetadata(url: string): Promise<music.IAudioMetadata | null> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      const options = {
        headers: {
            'Range': 'bytes=0-1048576',
            'Authorization': `Basic ${Buffer.from(`${this.user}:${this.password}`).toString('base64')}`
        }
      };

      const req = protocol.get(url, options, (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          return resolve(null);
        }

        music.parseStream(res as any, { mimeType: res.headers['content-type'] }, { skipCovers: false })
          .then((metadata) => {
            req.destroy();
            resolve(metadata);
          })
          .catch(() => {
            req.destroy();
            resolve(null);
          });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }
}

// No default export to avoid confusion with multiple scanner classes in one file
