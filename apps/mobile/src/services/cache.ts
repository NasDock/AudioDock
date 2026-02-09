import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Track } from '../models';

const CACHE_DIR = `${FileSystem.documentDirectory || ''}audio_cache/`;
const OFFLINE_TRACKS_KEY = 'offline_tracks';

/**
 * Ensure the cache directory exists
 */
export const ensureCacheDirExists = async () => {
  const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
};

/**
 * Get the local path for a track
 */
export const getLocalPath = (trackId: number | string, originalPath: string): string => {
  const extension = originalPath.split('.').pop() || 'mp3';
  return `${CACHE_DIR}${trackId}.${extension}`;
};

/**
 * Check if a track is cached locally
 */
export const isCached = async (trackId: number | string, originalPath: string): Promise<string | null> => {
  try {
    const localPath = getLocalPath(trackId, originalPath);
    const fileInfo = await FileSystem.getInfoAsync(localPath);
    return fileInfo.exists ? localPath : null;
  } catch (e) {
    return null;
  }
};

const downloadPromises = new Map<number | string, Promise<string | null>>();

/**
 * Download a track to the local cache and save metadata
 */
export const downloadTrack = async (track: Track, url: string): Promise<string | null> => {
  if (downloadPromises.has(track.id)) {
    return downloadPromises.get(track.id)!;
  }

  const downloadPromise = (async () => {
    try {
      if (!url) return null;
      
      await ensureCacheDirExists();
      const localPath = getLocalPath(track.id, url);
      const tempPath = `${localPath}.tmp`;
      
      // Check if already exists to avoid redownloading
      const fileInfo = await FileSystem.getInfoAsync(localPath);
      if (fileInfo.exists) {
        await saveTrackMetadata(track, localPath);
        return localPath;
      }

      console.log(`[Cache] Starting download for track ${track.id}: ${url} to temp path`);
      const downloadRes = await FileSystem.downloadAsync(url, tempPath);
      
      if (downloadRes.status === 200) {
        // Atomic move to final destination
        await FileSystem.moveAsync({
          from: tempPath,
          to: localPath
        });
        
        console.log(`[Cache] Successfully downloaded and verified track ${track.id}`);
        await saveTrackMetadata(track, localPath);
        return localPath;
      } else {
        // Cleanup temp file if download failed
        await FileSystem.deleteAsync(tempPath, { idempotent: true });
        return null;
      }
    } catch (e) {
      console.error(`[Cache] Failed to download track ${track.id}`, e);
      return null;
    } finally {
      downloadPromises.delete(track.id);
    }
  })();

  downloadPromises.set(track.id, downloadPromise);
  return downloadPromise;
};

/**
 * Save track metadata to AsyncStorage
 */
const saveTrackMetadata = async (track: Track, localPath: string) => {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_TRACKS_KEY);
    const tracks: Track[] = stored ? JSON.parse(stored) : [];
    
    const existingIndex = tracks.findIndex(t => t.id === track.id);
    // Overwrite path with local path for offline playback
    const trackWithLocalPath = { ...track, path: localPath };
    
    if (existingIndex > -1) {
      tracks[existingIndex] = trackWithLocalPath;
    } else {
      tracks.push(trackWithLocalPath);
    }
    
    await AsyncStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(tracks));
  } catch (e) {
    console.error("Failed to save track metadata", e);
  }
}

/**
 * Get all downloaded tracks
 */
export const getDownloadedTracks = async (): Promise<Track[]> => {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_TRACKS_KEY);
    if (!stored) return [];
    
    const tracks: Track[] = JSON.parse(stored);
    
    // Optional: Verify file existence and clean up
    const validTracks: Track[] = [];
    let hasChanges = false;

    for (const track of tracks) {
      if (track.path && await isCached(track.id, track.path)) {
        validTracks.push(track);
      } else {
        hasChanges = true;
      }
    }

    if (hasChanges) {
        await AsyncStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(validTracks));
    }

    return validTracks;
  } catch (e) {
    console.error("Failed to get downloaded tracks", e);
    return [];
  }
};

/**
 * Remove a downloaded track
 */
export const removeDownloadedTrack = async (trackId: number | string, url?: string) => {
    try {
        // Remove file
        if (url) {
            const localPath = getLocalPath(trackId, url);
            await FileSystem.deleteAsync(localPath, { idempotent: true });
        } else {
             // Try to find path from metadata
              const stored = await AsyncStorage.getItem(OFFLINE_TRACKS_KEY);
              if (stored) {
                  const tracks: Track[] = JSON.parse(stored);
                  const track = tracks.find(t => t.id === trackId);
                  if (track && track.path) {
                       // If path is already local (starts with file:// or contains audio_cache), use it directly?
                       // getLocalPath appends ID and extension. track.path IS the local path we saved.
                       // But wait, isCached checks getLocalPath(id, originalUrl).
                       // If we saved localPath to track.path, we can just delete it?
                       // Yes, if track.path is the file path.
                       // But earlier we used `getLocalPath` which derives name from ID + extension of ORIGINAL url.
                       // If we don't have original URL extension, we might fail to delete if we constructed the path wrong?
                       // But track.path should be the absolute local path we saved.
                       await FileSystem.deleteAsync(track.path, { idempotent: true });
                  }
              }
        }

        // Remove from metadata
        const stored = await AsyncStorage.getItem(OFFLINE_TRACKS_KEY);
        if (stored) {
            const tracks: Track[] = JSON.parse(stored);
            const newTracks = tracks.filter(t => t.id !== trackId);
            await AsyncStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(newTracks));
        }
    } catch (e) {
        console.error("Failed to remove downloaded track", e);
    }
}

/**
 * Format local path for TrackPlayer (ensuring file:// prefix)
 */
export const resolveLocalPath = (path: string): string => {
  if (path.startsWith('file://')) return path;
  if (path.startsWith('/')) return `file://${path}`;
  return path;
};

/**
 * Get cache size in bytes for a specific directory
 */
export const getDirectorySize = async (dirPath: string): Promise<number> => {
  try {
    const dirInfo = await FileSystem.getInfoAsync(dirPath);
    if (!dirInfo.exists) return 0;
    if (!dirInfo.isDirectory) return dirInfo.size || 0;

    const files = await FileSystem.readDirectoryAsync(dirPath);
    let totalSize = 0;
    for (const file of files) {
      const fileInfo = await FileSystem.getInfoAsync(`${dirPath}${file}`);
      if (fileInfo.exists) {
        if (fileInfo.isDirectory) {
          totalSize += await getDirectorySize(`${dirPath}${file}/`);
        } else {
          totalSize += fileInfo.size || 0;
        }
      }
    }
    return totalSize;
  } catch (e) {
    return 0;
  }
};

export interface DetailedCacheSize {
  covers: number;
  music: number;
  audiobooks: number;
  apks: number;
}

/**
 * Get detailed cache size dimensions
 */
export const getDetailedCacheSize = async (): Promise<DetailedCacheSize> => {
  const result: DetailedCacheSize = {
    covers: 0,
    music: 0,
    audiobooks: 0,
    apks: 0,
  };

  try {
    // 1. APKs (in cacheDirectory)
    const cacheDir = FileSystem.cacheDirectory || '';
    if (cacheDir) {
      const files = await FileSystem.readDirectoryAsync(cacheDir);
      for (const file of files) {
        if (file.endsWith('.apk')) {
          const info = await FileSystem.getInfoAsync(`${cacheDir}${file}`);
          if (info.exists) result.apks += info.size || 0;
        }
      }
    }

    // 2. Music & Audiobooks (in CACHE_DIR)
    const stored = await AsyncStorage.getItem(OFFLINE_TRACKS_KEY);
    if (stored) {
      const tracks: Track[] = JSON.parse(stored);
      for (const track of tracks) {
        if (track.path) {
          const info = await FileSystem.getInfoAsync(track.path);
          if (info.exists) {
            if (track.type === 'AUDIOBOOK') {
               result.audiobooks += info.size || 0;
            } else {
               result.music += info.size || 0;
            }
          }
        }
      }
    }

    // 3. Covers (Image Cache)
    // expo-image stores its cache in different locations based on version and platform
    const imageCacheDirs = [
      `${FileSystem.cacheDirectory}ImageCache/`,        // Older expo-image
      `${FileSystem.cacheDirectory}expo-image-cache/`,   // Newer expo-image
      `${FileSystem.cacheDirectory}GlideCache/`,        // Android Glide
      `${FileSystem.cacheDirectory}com.hackemist.SDImageCache/`, // iOS SDWebImage
    ];
    
    for (const dir of imageCacheDirs) {
      const size = await getDirectorySize(dir);
      result.covers += size;
    }

  } catch (e) {
    console.error("Failed to get detailed cache size", e);
  }

  return result;
};

/**
 * Clear specific cache category
 */
export const clearSpecificCache = async (category: keyof DetailedCacheSize) => {
  try {
    switch (category) {
      case 'apks':
        const cacheDir = FileSystem.cacheDirectory || '';
        if (cacheDir) {
          const files = await FileSystem.readDirectoryAsync(cacheDir);
          for (const file of files) {
            if (file.endsWith('.apk')) {
              await FileSystem.deleteAsync(`${cacheDir}${file}`, { idempotent: true });
            }
          }
        }
        break;
      
      case 'covers':
        // Clear all potential image cache directories
        const imageCacheDirs = [
          `${FileSystem.cacheDirectory}ImageCache/`,
          `${FileSystem.cacheDirectory}expo-image-cache/`,
          `${FileSystem.cacheDirectory}GlideCache/`,
          `${FileSystem.cacheDirectory}com.hackemist.SDImageCache/`,
        ];
        for (const dir of imageCacheDirs) {
          try {
            await FileSystem.deleteAsync(dir, { idempotent: true });
          } catch (e) {
            // Ignore errors for individual directories
          }
        }
        break;

      case 'music':
      case 'audiobooks':
        const type = category === 'music' ? 'MUSIC' : 'AUDIOBOOK';
        const stored = await AsyncStorage.getItem(OFFLINE_TRACKS_KEY);
        if (stored) {
          const tracks: Track[] = JSON.parse(stored);
          const tracksToClear = tracks.filter(t => t.type === type);
          const tracksToKeep = tracks.filter(t => t.type !== type);
          
          for (const track of tracksToClear) {
            if (track.path) {
              await FileSystem.deleteAsync(track.path, { idempotent: true });
            }
          }
          await AsyncStorage.setItem(OFFLINE_TRACKS_KEY, JSON.stringify(tracksToKeep));
        }
        break;
    }
  } catch (e) {
    console.error(`Failed to clear ${category} cache`, e);
  }
};

/**
 * Clear all cached audio files (Deprecated in favor of clearSpecificCache)
 */
export const clearCache = async () => {
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
    await ensureCacheDirExists();
    await AsyncStorage.removeItem(OFFLINE_TRACKS_KEY);
    // Also clear covers and apks for full clear
    await clearSpecificCache('covers');
    await clearSpecificCache('apks');
  } catch (e) {
    console.error('Failed to clear cache', e);
  }
};

/**
 * Get total cache size in bytes
 */
export const getCacheSize = async (): Promise<number> => {
  const detailed = await getDetailedCacheSize();
  return detailed.music + detailed.audiobooks + detailed.covers + detailed.apks;
};
