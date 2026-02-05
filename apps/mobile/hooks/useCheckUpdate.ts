import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { checkLocalApkExists, compareVersions, downloadAndInstallApk, getLocalApkUri, getLocalVersion, installApk } from '../src/utils/updateUtils';
// 配置常量
const GITHUB_USER = 'mmdctjj';
const GITHUB_REPO = 'AudioDock';
const USE_GHPROXY = false; // 开启加速

export interface UpdateInfo {
  version: string;
  body: string;
  downloadUrl: string;
}

export const useCheckUpdate = () => {
  // UI 状态
  const [progress, setProgress] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const checkUpdate = async () => {
    if (Platform.OS !== 'android') return;

    try {
      // 1. 请求 GitHub API
      const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest`;
      const response = await fetch(apiUrl);
      console.log(response);
      const data = await response.json();

      // 2. 解析版本 (Tag: v1.0.59 -> 1.0.59)
      const tagName = data.tag_name;
      if (!tagName) return;
      const remoteVersion = tagName.replace(/^v/, '');
      const localVersion = getLocalVersion();

      console.log(`本地: ${localVersion}, 线上: ${remoteVersion}`);

      // Check ignore
      const ignoredVersion = await AsyncStorage.getItem("ignored_version");
      if (remoteVersion === ignoredVersion) {
        console.log(`Version ${remoteVersion} is ignored.`);
        return;
      }

      // 3. 比对版本
      if (compareVersions(remoteVersion, localVersion) === 1) {

        // 寻找 APK 资源
        const apkAsset = data.assets?.find((a: any) => a.name.endsWith('.apk'));
        
        if (!apkAsset) {
          console.log(`Version ${remoteVersion} found but no APK asset found in release.`);
          return;
        }

        let downloadUrl = apkAsset.browser_download_url;
        console.log(`Found APK: ${downloadUrl}`);

        if (USE_GHPROXY) {
          downloadUrl = `https://mirror.ghproxy.com/${downloadUrl}`;
        }

        // 4. 设置更新信息，不再弹出 Alert
        setUpdateInfo({
          version: remoteVersion,
          body: data.body || '建议立即更新体验新功能',
          downloadUrl: downloadUrl
        });

        // 5. 检查本地是否已经下载过
        const exists = await checkLocalApkExists(downloadUrl);
        if (exists) {
          setProgress(1); // 如果已存在，直接标记进度为完成
        } else {
          setProgress(0);
        }
      }
    } catch (error) {
      console.error('检查更新失败', error);
    }
  };

  const startUpdate = () => {
    if (updateInfo) {
      startDownload(updateInfo.downloadUrl);
      // Keep updateInfo to show progress in the same modal context if needed, 
      // or we can rely on progress > 0.
      // But typically we might want to hide the "Prompt" part. 
      // setUpdateInfo(null); // Do not clear yet if we want to use the info for title etc.
    }
  };

  const ignoreUpdate = async () => {
    if (updateInfo) {
      await AsyncStorage.setItem("ignored_version", updateInfo.version);
      setUpdateInfo(null);
    }
  };

  const cancelUpdate = () => {
    setUpdateInfo(null);
  };

  const installLocalUpdate = async () => {
    if (updateInfo) {
      const localUri = getLocalApkUri(updateInfo.downloadUrl);
      try {
        await installApk(localUri);
      } catch (e) {
        Alert.alert('安装失败', '无法打开安装程序');
      }
    }
  };

  // 内部函数：处理下载流程
  const startDownload = async (url: string) => {
    setProgress(0);

    try {
      await downloadAndInstallApk(url, (p) => {
        setProgress(p); // 实时更新进度条
      });
    } catch (e) {
      Alert.alert('更新失败', '网络连接错误，请重试');
    }
  };

  // 返回：触发函数 + UI组件
  return {
    checkUpdate,
    progress,
    updateInfo,
    startUpdate,
    ignoreUpdate,
    cancelUpdate,
    installLocalUpdate
  };
};