import { spawn } from 'child_process';
import { app, BrowserWindow, dialog, screen as electronScreen, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } from 'electron';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from "os";
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

function getDeviceName() {
  const hostname = os.hostname().replace(/\.local$/, "");
  const platform = process.platform;

  if (platform === "darwin") return `${hostname}（Mac）`;
  if (platform === "win32") return `${hostname}（Windows）`;
  return hostname;
}

// Helper to check audio codec
const checkAudioCodec = (filePath: string): Promise<string> => {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    let output = '';
    p.stdout.on('data', (d) => output += d.toString());
    p.on('close', () => resolve(output.trim()));
    p.on('error', (e) => {
      console.warn("ffprobe failed", e);
      resolve('');
    });
  });
};

ipcMain.handle("get-device-name", () => {
    return getDeviceName();
  });

ipcMain.handle("get-auto-launch", () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("player:get-state", () => {
  return playerState;
});

ipcMain.handle("set-auto-launch", (event, enable: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath,
  });
});

ipcMain.handle("select-directory", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("open-url", (event, url: string) => {
  console.log('Opening URL:', url);
  return shell.openExternal(url);
});

ipcMain.handle("open-directory", async (event, folderPath: string) => {
  const fullPath = folderPath.replace(/^~/, os.homedir());
  if (!fs.existsSync(fullPath)) {
    try {
      fs.mkdirSync(fullPath, { recursive: true });
    } catch (e) {
      console.error("Failed to create directory:", e);
      return "Directory does not exist and could not be created";
    }
  }
  return shell.openPath(fullPath);
});

// ---- Optimized Split Caching & Download Logic ----

const CACHE_DIR = path.join(app.getPath('userData'), 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

interface TrackMetadata {
  id: number;
  path: string;
  name: string;
  artist: string;
  album: string;
  albumId?: number;
  duration: number | null;
  type: string;
  cover?: string | null;
  lyrics?: string | null;
  localPath?: string; // Relative path to audio file from downloadPath
}

const getTrackAudioLocalPath = (basePath: string, type: string, albumName: string, originalPath: string) => {
  // Decode the filename from the path to avoid URL encoding in the filename (e.g. %20 -> space)
  const decodedPath = decodeURIComponent(originalPath);
  const fileName = path.basename(decodedPath); 
  const subFolder = type === 'MUSIC' ? 'music' : path.join('audio', albumName.replace(/[/\\?%*:|"<>]/g, '-'));
  return {
    filePath: path.join(basePath.replace(/^~/, os.homedir()), subFolder, fileName),
    relPath: path.join(subFolder, fileName).replace(/\\/g, '/')
  };
};

const activeDownloads = new Map<number, Promise<string | null>>();

ipcMain.handle("cache:check", async (event, trackId: number, originalPath: string, downloadPath: string, type: string, albumName: string) => {
  // 1. Check if metadata exists in cache
  const metaPath = path.join(CACHE_DIR, `${trackId}.json`);
  if (!fs.existsSync(metaPath)) return null;

  try {
    const metadata: TrackMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (!metadata.localPath) return null;

    // 2. Check if audio file exists in downloadPath
    const filePath = path.join(downloadPath.replace(/^~/, os.homedir()), metadata.localPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return `media://audio/${metadata.localPath}`;
    }
  } catch (e) {
    console.error("[Main] cache:check error", e);
  }
  return null;
});

ipcMain.handle("cache:download", async (event, trackId: number, url: string, downloadPath: string, type: string, albumName: string, metadata: TrackMetadata, token?: string) => {
  if (activeDownloads.has(trackId)) return activeDownloads.get(trackId);

  const downloadPromise = (async () => {
    let tempPath = '';
    try {
      const { filePath, relPath } = getTrackAudioLocalPath(downloadPath, type, albumName, new URL(url).pathname);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      
      tempPath = filePath + '.tmp';
      if (fs.existsSync(filePath)) {
        // Even if audio exists, ensure metadata is in cache
        metadata.localPath = relPath;
        fs.writeFileSync(path.join(CACHE_DIR, `${trackId}.json`), JSON.stringify(metadata, null, 2));
        return `media://audio/${relPath}`;
      }

      console.log(`[Main] Starting split download for track ${trackId}: ${url}`);
      const headers: Record<string, string> = { 'User-Agent': 'SoundX-Desktop' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // 1. Download Audio to downloadPath
      const response = await net.fetch(url, { headers });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      const body = response.body;
      if (!body) throw new Error("Body empty");
      await pipeline(Readable.fromWeb(body as any), fs.createWriteStream(tempPath));
      fs.renameSync(tempPath, filePath);

      // 2. Download Cover if exists and store in CACHE_DIR
      if (metadata.cover) {
        try {
          const coverUrl = metadata.cover;
          console.log(`[Main] Downloading cover: ${coverUrl}`);
          const coverExt = path.extname(new URL(coverUrl).pathname) || '.jpg';
          const coverName = `${trackId}_cover${coverExt}`;
          const cRes = await net.fetch(coverUrl);
          
          if (cRes.ok && cRes.body) {
            const contentType = cRes.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
              throw new Error("Received HTML instead of image (likely dev server fallback)");
            }

            const buffer = await cRes.arrayBuffer();
            // Basic sanity check: first few bytes shouldn't look like HTML
            const snippet = Buffer.from(buffer.slice(0, 10)).toString();
            if (snippet.toLowerCase().includes('<!doc') || snippet.toLowerCase().includes('<html')) {
              throw new Error("Response content looks like HTML");
            }

            fs.writeFileSync(path.join(CACHE_DIR, coverName), Buffer.from(buffer));
            metadata.cover = `media://cover/${coverName}`;
          }
        } catch (ce) {
          console.error("[Main] Cover download failed:", ce);
        }
      }

      // 3. Write Metadata to CACHE_DIR
      metadata.localPath = relPath;
      fs.writeFileSync(path.join(CACHE_DIR, `${trackId}.json`), JSON.stringify(metadata, null, 2));

      console.log(`[Main] Successfully cached/downloaded track ${trackId}`);
      return `media://audio/${relPath}`;
    } catch (error) {
      console.error(`[Main] Split download failed for ${trackId}:`, error);
      if (tempPath && fs.existsSync(tempPath)) try { fs.unlinkSync(tempPath); } catch(e) {}
      return null;
    } finally {
      activeDownloads.delete(trackId);
    }
  })();

  activeDownloads.set(trackId, downloadPromise);
  return downloadPromise;
});

ipcMain.handle("cache:list", async (event, downloadPath: string, type: string) => {
  try {
    const results: any[] = [];
    if (!fs.existsSync(CACHE_DIR)) return [];

    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf8'));
          if (data.type === type) {
            // Verify audio file still exists
            const fullAudioPath = path.join(downloadPath.replace(/^~/, os.homedir()), data.localPath);
            if (fs.existsSync(fullAudioPath)) {
              results.push(data);
            }
          }
        } catch (e) {}
      }
    }
    return results;
  } catch (error) {
    console.error("[Main] cache:list failed", error);
    return [];
  }
});

// We need a way to know the current download path for the protocol handler
let currentDownloadPath = '';
ipcMain.on("settings:update-download-path", (event, path: string) => {
  currentDownloadPath = path;
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public');

let win: BrowserWindow | null = null;
let lyricWin: BrowserWindow | null = null;
let miniWin: BrowserWindow | null = null;

let trayPrev: Tray | null = null;
let trayPlay: Tray | null = null;
let trayNext: Tray | null = null;
let trayMain: Tray | null = null;

// ---- 播放器状态 ----
let playerState = {
  isPlaying: false,
  track: null as null | { name: string; artist: string; album?: string },
};

let minimizeToTray = true;
let isQuitting = false;

// ---------- UI 更新统一入口 ----------
function updatePlayerUI(shouldUpdateTitle = true) {
  // 1）更新播放按钮图标
  const playIcon = playerState.isPlaying ? "pause.png" : "play.png";
  if (trayPlay) {
    const img = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC!, playIcon)).resize({ width: 18, height: 18 });
    if (process.platform === 'darwin') img.setTemplateImage(true);
    trayPlay.setImage(img);
  }

  // 2）更新导航栏歌词标题（macOS 专用）
  if (process.platform === "darwin" && shouldUpdateTitle) {
    if (playerState.track) {
      trayNext?.setTitle(`${playerState.track.name} - ${playerState.track.artist}`);
    } else {
      trayNext?.setTitle(""); // 未播放时清空
    }
  }

  // 3）更新右键菜单
  const menuItems: any[] = [];

  if (playerState.track) {
    menuItems.push(
      { label: `♫ ${playerState.track.name}`, enabled: false },
      { label: `   ${playerState.track.artist}`, enabled: false },
      { type: 'separator' },
      { label: "⏮ 上一曲", click: () => win?.webContents.send("player:prev") },
      {
        label: playerState.isPlaying ? "⏸ 暂停" : "▶️ 播放",
        click: () => win?.webContents.send("player:toggle"),
      },
      { label: "⏭ 下一曲", click: () => win?.webContents.send("player:next") },
      { type: "separator" }
    );
  }

  menuItems.push(
    { label: "打开播放器", click: () => win?.show() },
    { label: "退出", click: () => app.quit() }
  );

  const menu = Menu.buildFromTemplate(menuItems);
  trayMain?.setContextMenu(menu);
}
// ---------- IPC：合并为一个事件 ----------
ipcMain.on("player:update", (event, payload) => {
  playerState = { ...playerState, ...payload };
  // Only update title if track info changed
  const shouldUpdateTitle = payload.track !== undefined;
  updatePlayerUI(shouldUpdateTitle);
  // Sync with lyric window
  lyricWin?.webContents.send("player:update", payload);
  miniWin?.webContents.send("player:update", payload);
});

ipcMain.on("settings:update-minimize-to-tray", (event, value: boolean) => {
  minimizeToTray = value;
});

ipcMain.on("lyric:update", (event, payload) => {
  const { currentLyric } = payload;

  // macOS 托盘标题更新
  if (process.platform === "darwin") {
      const displayTitle = currentLyric || (playerState.track ? `${playerState.track.name} - ${playerState.track.artist}` : "");
      trayNext?.setTitle(displayTitle);
  }

  // 同步桌面投影歌词
  lyricWin?.webContents.send("lyric:update", payload);
  miniWin?.webContents.send("lyric:update", payload);
});

ipcMain.on("lyric:settings-update", (event, payload) => {
  lyricWin?.webContents.send("lyric:settings-update", payload);
});

ipcMain.on("lyric:open", (event, settings) => {
  createLyricWindow(settings);
});

ipcMain.on("lyric:close", () => {
  if (lyricWin) {
    lyricWin.close();
    lyricWin = null;
  }
});

ipcMain.on("lyric:set-mouse-ignore", (event, ignore: boolean) => {
  lyricWin?.setIgnoreMouseEvents(ignore, { forward: true });
});

// Bridge playback controls from lyric window to main window
ipcMain.on("player:toggle", () => {
  console.log("Main process: received player:toggle");
  if (win) {
    console.log("Main process: forwarding player:toggle to main window");
    win.webContents.send("player:toggle");
  } else {
    console.warn("Main process: win is null, cannot forward player:toggle");
  }
});

ipcMain.on("player:next", () => {
  console.log("Main process: received player:next");
  win?.webContents.send("player:next");
});

ipcMain.on("player:prev", () => {
  win?.webContents.send("player:prev");
});

ipcMain.on("player:seek", (event, time: number) => {
  win?.webContents.send("player:seek", time);
});

// ---- 窗口模式切换 ----
ipcMain.on("window:set-mini", () => {
  if (win) {
     win.hide();
     createMiniPlayerWindow();
  }
});

ipcMain.on("window:restore-main", () => {
  if (miniWin) {
     miniWin.close();
     miniWin = null;
  }
  if (win) {
    win.show();
    win.center();
  }
});

ipcMain.on("app:show-main", () => {
  if (win) {
    if (win.isVisible()) {
      win.focus();
    } else {
      win.show();
    }
  }
});

ipcMain.on("window:set-always-on-top", (event, enable: boolean) => {
  if (miniWin) {
    miniWin.setAlwaysOnTop(enable, "floating");
  }
});

function createMiniPlayerWindow() {
   if (miniWin) {
      miniWin.show();
      return;
   }

   miniWin = new BrowserWindow({
      width: 360,
      height: 170,
      frame: false,
      titleBarStyle: "hidden",
      resizable: false,
      alwaysOnTop: true, // Start always on top
      skipTaskbar: true,
      hasShadow: false,
      transparent: true,
      vibrancy: "popover",
      visualEffectState: "active",
      webPreferences: {
         contextIsolation: true,
         nodeIntegration: false,
         preload: path.join(__dirname, "preload.mjs"),
      }
   });

   const miniUrl = process.env.VITE_DEV_SERVER_URL
     ? `${process.env.VITE_DEV_SERVER_URL}#/mini`
     : `app://./index.html#/mini`;

   if (process.env.VITE_DEV_SERVER_URL) {
      miniWin.loadURL(miniUrl);
   } else {
      miniWin.loadURL(miniUrl);
   }
   
   // macOS tweaks
   if (process.platform === "darwin") {
      miniWin.setAlwaysOnTop(true, "floating");
      miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
   }

   miniWin.on("closed", () => {
      miniWin = null;
   });
}

// ---------- 创建窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'logo.png'),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "rgba(0,0,0,0)",
      symbolColor: "#ffffff",
      height: 30,
    },
    width: 1020, // 初始宽度
    height: 700, // 初始高度
    minWidth: 1020, // 🔧 设置窗口最小宽度
    minHeight: 700, // 🔧 设置窗口最小高度
    transparent: process.platform === "darwin",
    opacity: 0.95,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: true,   // 明确开启
      nodeIntegration: false,  // 保持安全
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.on('close', (event) => {
    if (!isQuitting && minimizeToTray) {
      event.preventDefault();
      win?.hide();
    }
    return false;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadURL("app://./index.html");
  }
}

function createLyricWindow(settings?: any) {
  if (lyricWin) return;

  const { width: screenWidth, height: screenHeight } = electronScreen.getPrimaryDisplay().workAreaSize;
  const winWidth = 800;
  const winHeight = 120;

  const x = settings?.x !== undefined ? settings.x : Math.floor((screenWidth - winWidth) / 2);
  const y = settings?.y !== undefined ? settings.y : screenHeight - winHeight - 50;

  lyricWin = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    hiddenInMissionControl: true, // Prevent Mission Control interference
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  const lyricUrl = process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}#/lyric`
    : `${path.join(process.env.DIST!, "index.html")}#/lyric`;

  if (process.env.VITE_DEV_SERVER_URL) {
    lyricWin.loadURL(lyricUrl);
  } else {
    lyricWin.loadURL("app://./index.html#/lyric");
  }

  // macOS specific window settings for better "transparency" and persistence
  if (process.platform === "darwin") {
    lyricWin.setAlwaysOnTop(true, "screen-saver");
    lyricWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // Persist position on move
  let moveTimeout: NodeJS.Timeout | null = null;
  lyricWin.on("move", () => {
     if (moveTimeout) clearTimeout(moveTimeout);
     moveTimeout = setTimeout(() => {
        if (lyricWin && win) {
           const [newX, newY] = lyricWin.getPosition();
           win.webContents.send("lyric:position-updated", { x: newX, y: newY });
        }
     }, 500);
  });

  lyricWin.on("closed", () => {
    lyricWin = null;
  });
}

// ---------- 托盘 ----------
function createTray() {
  const img = (name: string, size = 20) => {
    const icon = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC!, name));
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
    return icon.resize({ width: size, height: size });
  };

  if (process.platform === 'darwin') {
    // macOS: 多个图标常驻菜单栏
    trayNext = new Tray(img("next.png"));
    trayPlay = new Tray(img("play.png"));
    trayPrev = new Tray(img("previous.png"));
    trayMain = new Tray(img("mini_logo.png"));

    trayNext.on("click", () => win?.webContents.send("player:next"));
    trayPlay.on("click", () => win?.webContents.send("player:toggle"));
    trayPrev.on("click", () => win?.webContents.send("player:prev"));
  } else {
    // Windows/Linux: 单个彩色图标
    const logoImg = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC!, "logo.png"))
      .resize({ width: 24, height: 24 });
    trayMain = new Tray(logoImg);
    trayMain.setToolTip("AudioDock");
  }

  trayMain.on("click", () => {
    if (win) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
      }
    }
  });

  updatePlayerUI();
}

// ---------- APP 生命周期 ----------
app.on('before-quit', () => {
  isQuitting = true;
});

// 必须放在 app.whenReady() 之前！
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      corsEnabled: true
    }
  },
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true, 
      corsEnabled: true, // often needed for media elements
      stream: true
    }
  }
])

app.whenReady().then(() => {
  console.log(`[Main] App is ready.`);
  console.log(`[Main] CACHE_DIR set to: ${CACHE_DIR}`);
  console.log(`[Main] Initial Download Path: ${currentDownloadPath || 'Default (app/downloads)'}`);

  // Register custom protocol for stable localStorage origin
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/')) pathname = pathname.slice(1);
      
      const filePath = path.join(process.env.DIST!, pathname || 'index.html');
      console.log(`[Main] App Protocol: url=${request.url} -> filePath=${filePath}`);
      
      return net.fetch(pathToFileURL(filePath).href);
    } catch (e) {
      console.error("[Main] App protocol error:", e);
      return new Response('Internal error', { status: 500 });
    }
  });

  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.host; 
      
      let pathname = url.pathname;
      if (pathname.startsWith('/')) pathname = pathname.slice(1);
      
      const decodedPathname = decodeURIComponent(pathname);

      const getPath = (h: string, p: string) => {
        if (h === 'audio') {
          const base = currentDownloadPath || path.join(app.getPath('userData'), 'downloads');
          return path.join(base.replace(/^~/, os.homedir()), p);
        } else if (h === 'cover' || h === 'metadata') {
          return path.join(CACHE_DIR, p);
        } else {
          // If host is neither, it could be a legacy file path
          const base = currentDownloadPath || path.join(app.getPath('userData'), 'audio_cache');
          return path.join(base.replace(/^~/, os.homedir()), h, p);
        }
      };

      let filePath = getPath(host, decodedPathname);
      
      // Super defensive: if not found, try searching directly in CACHE_DIR 
      // This handles cases where host might be misplaced (e.g. media://3371_cover.jpeg)
      if (!fs.existsSync(filePath)) {
        const altCachePath = path.join(CACHE_DIR, decodedPathname || host);
        if (fs.existsSync(altCachePath)) {
          console.log(`[Main] File found via CACHEFallback: ${altCachePath}`);
          filePath = altCachePath;
        }
      }

      const exists = fs.existsSync(filePath);
      console.log(`[Main] Media Protocol: url=${request.url} -> host=${host}, path=${decodedPathname} -> filePath=${filePath} (exists: ${exists})`);

      if (!exists) {
        return new Response('File Not Found', { status: 404 });
      }

      // Explicitly set MIME types to help renderer
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.mp3') contentType = 'audio/mpeg';
      else if (ext === '.flac') contentType = 'audio/flac';
      else if (ext === '.wav') contentType = 'audio/wav';
      else if (ext === '.aac') contentType = 'audio/aac';
      else if (ext === '.json') contentType = 'application/json';

      // Special handling for m4a to detect ALAC
      if (ext === '.m4a') {
         const codec = await checkAudioCodec(filePath);
         if (codec === 'alac') {
             console.log(`[Main] Detected ALAC codec for ${filePath}, transcoding to WAV...`);
             const ffmpeg = spawn('ffmpeg', ['-i', filePath, '-f', 'wav', '-']);
             
             // Stream the output
             return new Response(Readable.toWeb(ffmpeg.stdout) as any, {
                 headers: { 
                   'Content-Type': 'audio/wav',
                   'Access-Control-Allow-Origin': '*',
                   'Cache-Control': 'no-cache'
                 }
             });
         }
         // Metadata or AAC
         contentType = 'audio/mp4';
      }

      // For covers and metadata, we can use readFileSync for reliability
      // For large audio files, net.fetch is preferred for streaming
      if (host === 'cover' || host === 'metadata' || ext === '.json' || ext === '.jpeg' || ext === '.jpg' || ext === '.png') {
        const fileData = fs.readFileSync(filePath);
        return new Response(fileData, {
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          }
        });
      }

      const fileUrl = pathToFileURL(filePath).href;
      const response = await net.fetch(fileUrl);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (e) {
      console.error("[Main] Protocol handle error:", e);
      return new Response('Internal error', { status: 500 });
    }
  });

  createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    win?.show();
  }
});