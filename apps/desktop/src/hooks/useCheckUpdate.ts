import { useState } from 'react';
import pkg from '../../package.json';

const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';

export interface UpdateInfo {
  version: string;
  body: string;
  downloadUrl: string;
  assets: any[];
}

export const useCheckUpdate = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const checkUpdate = async (manual = false) => {
    setLoading(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest`);
      const data = await res.json();
      const remoteVersion = data.tag_name?.replace(/^v/, '');
      const localVersion = pkg.version;

      if (remoteVersion && compareVersions(remoteVersion, localVersion) > 0) {
        // Find asset based on platform
        const platform = getPlatform();
        let asset = null;
        if (data.assets && Array.isArray(data.assets)) {
          if (platform === 'win') {
             // Prefer setup exe, exclude blockmap
             asset = data.assets.find((a: any) => a.name.endsWith('.exe') && !a.name.includes('blockmap'));
          } else if (platform === 'mac') {
             // Prefer dmg
             asset = data.assets.find((a: any) => a.name.endsWith('.dmg'));
             if (!asset) asset = data.assets.find((a: any) => a.name.endsWith('.zip') && !a.name.includes('source'));
          } else if (platform === 'linux') {
             asset = data.assets.find((a: any) => a.name.endsWith('.AppImage'));
             if (!asset) asset = data.assets.find((a: any) => a.name.endsWith('.deb'));
          }
        }

        if (!asset) {
          console.log(`No matching asset found for platform ${platform} in version ${remoteVersion}`);
          return;
        }

        const downloadUrl = asset.browser_download_url;

        setUpdateInfo({
          version: remoteVersion,
          body: data.body,
          downloadUrl: downloadUrl,
          assets: data.assets
        });
      } else {
         if(manual) {
             // We can return a status or let the caller handle 'no update' logic if needed,
             // currently just doing nothing for manual check 'no update' case in hook state.
             // Ideally we should have a callback or return value.
         }
      }
    } catch (e) {
      console.error("Check update failed", e);
    } finally {
      setLoading(false);
    }
  };

  const cancelUpdate = () => {
    setUpdateInfo(null);
  };

  return { checkUpdate, updateInfo, cancelUpdate, loading };
};

function compareVersions(v1: string, v2: string) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

function getPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}
