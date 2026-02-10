import { spawn } from "child_process";
import { ipcMain, app, dialog, shell, net, screen, BrowserWindow, protocol, Menu, Tray, nativeImage } from "electron";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
function getDeviceName() {
  const hostname = os.hostname().replace(/\.local$/, "");
  const platform = process.platform;
  if (platform === "darwin") return `${hostname}（Mac）`;
  if (platform === "win32") return `${hostname}（Windows）`;
  return hostname;
}
const checkAudioCodec = (filePath) => {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);
    let output = "";
    p.stdout.on("data", (d) => output += d.toString());
    p.on("close", () => resolve(output.trim()));
    p.on("error", (e) => {
      console.warn("ffprobe failed", e);
      resolve("");
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
ipcMain.handle("set-auto-launch", (event, enable) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    path: process.execPath
  });
});
ipcMain.handle("select-directory", async () => {
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});
ipcMain.handle("open-url", (event, url) => {
  console.log("Opening URL:", url);
  return shell.openExternal(url);
});
ipcMain.handle("open-directory", async (event, folderPath) => {
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
const CACHE_DIR = path.join(app.getPath("userData"), "audio_cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
const getTrackAudioLocalPath = (basePath, type, albumName, originalPath) => {
  const decodedPath = decodeURIComponent(originalPath);
  const fileName = path.basename(decodedPath);
  const subFolder = type === "MUSIC" ? "music" : path.join("audio", albumName.replace(/[/\\?%*:|"<>]/g, "-"));
  return {
    filePath: path.join(basePath.replace(/^~/, os.homedir()), subFolder, fileName),
    relPath: path.join(subFolder, fileName).replace(/\\/g, "/")
  };
};
const activeDownloads = /* @__PURE__ */ new Map();
ipcMain.handle("cache:check", async (event, trackId, originalPath, downloadPath, type, albumName) => {
  const metaPath = path.join(CACHE_DIR, `${trackId}.json`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (!metadata.localPath) return null;
    const filePath = path.join(downloadPath.replace(/^~/, os.homedir()), metadata.localPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return `media://audio/${metadata.localPath}`;
    }
  } catch (e) {
    console.error("[Main] cache:check error", e);
  }
  return null;
});
ipcMain.handle("cache:download", async (event, trackId, url, downloadPath, type, albumName, metadata, token) => {
  if (activeDownloads.has(trackId)) return activeDownloads.get(trackId);
  const downloadPromise = (async () => {
    let tempPath = "";
    try {
      const { filePath, relPath } = getTrackAudioLocalPath(downloadPath, type, albumName, new URL(url).pathname);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      tempPath = filePath + ".tmp";
      if (fs.existsSync(filePath)) {
        metadata.localPath = relPath;
        fs.writeFileSync(path.join(CACHE_DIR, `${trackId}.json`), JSON.stringify(metadata, null, 2));
        return `media://audio/${relPath}`;
      }
      console.log(`[Main] Starting split download for track ${trackId}: ${url}`);
      const headers = { "User-Agent": "SoundX-Desktop" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await net.fetch(url, { headers });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      const body = response.body;
      if (!body) throw new Error("Body empty");
      await pipeline(Readable.fromWeb(body), fs.createWriteStream(tempPath));
      fs.renameSync(tempPath, filePath);
      if (metadata.cover) {
        try {
          const coverUrl = metadata.cover;
          console.log(`[Main] Downloading cover: ${coverUrl}`);
          const coverExt = path.extname(new URL(coverUrl).pathname) || ".jpg";
          const coverName = `${trackId}_cover${coverExt}`;
          const cRes = await net.fetch(coverUrl);
          if (cRes.ok && cRes.body) {
            const contentType = cRes.headers.get("content-type");
            if (contentType && contentType.includes("text/html")) {
              throw new Error("Received HTML instead of image (likely dev server fallback)");
            }
            const buffer = await cRes.arrayBuffer();
            const snippet = Buffer.from(buffer.slice(0, 10)).toString();
            if (snippet.toLowerCase().includes("<!doc") || snippet.toLowerCase().includes("<html")) {
              throw new Error("Response content looks like HTML");
            }
            fs.writeFileSync(path.join(CACHE_DIR, coverName), Buffer.from(buffer));
            metadata.cover = `media://cover/${coverName}`;
          }
        } catch (ce) {
          console.error("[Main] Cover download failed:", ce);
        }
      }
      metadata.localPath = relPath;
      fs.writeFileSync(path.join(CACHE_DIR, `${trackId}.json`), JSON.stringify(metadata, null, 2));
      console.log(`[Main] Successfully cached/downloaded track ${trackId}`);
      return `media://audio/${relPath}`;
    } catch (error) {
      console.error(`[Main] Split download failed for ${trackId}:`, error);
      if (tempPath && fs.existsSync(tempPath)) try {
        fs.unlinkSync(tempPath);
      } catch (e) {
      }
      return null;
    } finally {
      activeDownloads.delete(trackId);
    }
  })();
  activeDownloads.set(trackId, downloadPromise);
  return downloadPromise;
});
ipcMain.handle("cache:list", async (event, downloadPath, type) => {
  try {
    const results = [];
    if (!fs.existsSync(CACHE_DIR)) return [];
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf8"));
          if (data.type === type) {
            const fullAudioPath = path.join(downloadPath.replace(/^~/, os.homedir()), data.localPath);
            if (fs.existsSync(fullAudioPath)) {
              results.push(data);
            }
          }
        } catch (e) {
        }
      }
    }
    return results;
  } catch (error) {
    console.error("[Main] cache:list failed", error);
    return [];
  }
});
let currentDownloadPath = "";
ipcMain.on("settings:update-download-path", (event, path2) => {
  currentDownloadPath = path2;
});
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win = null;
let lyricWin = null;
let miniWin = null;
let trayPrev = null;
let trayPlay = null;
let trayNext = null;
let trayMain = null;
let playerState = {
  isPlaying: false,
  track: null
};
let minimizeToTray = true;
let isQuitting = false;
function updatePlayerUI(shouldUpdateTitle = true) {
  const playIcon = playerState.isPlaying ? "pause.png" : "play.png";
  if (trayPlay) {
    const img = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, playIcon)).resize({ width: 18, height: 18 });
    if (process.platform === "darwin") img.setTemplateImage(true);
    trayPlay.setImage(img);
  }
  if (process.platform === "darwin" && shouldUpdateTitle) {
    if (playerState.track) {
      trayNext?.setTitle(`${playerState.track.name} - ${playerState.track.artist}`);
    } else {
      trayNext?.setTitle("");
    }
  }
  const menuItems = [];
  if (playerState.track) {
    menuItems.push(
      { label: `♫ ${playerState.track.name}`, enabled: false },
      { label: `   ${playerState.track.artist}`, enabled: false },
      { type: "separator" },
      { label: "⏮ 上一曲", click: () => win?.webContents.send("player:prev") },
      {
        label: playerState.isPlaying ? "⏸ 暂停" : "▶️ 播放",
        click: () => win?.webContents.send("player:toggle")
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
ipcMain.on("player:update", (event, payload) => {
  playerState = { ...playerState, ...payload };
  const shouldUpdateTitle = payload.track !== void 0;
  updatePlayerUI(shouldUpdateTitle);
  lyricWin?.webContents.send("player:update", payload);
  miniWin?.webContents.send("player:update", payload);
});
ipcMain.on("settings:update-minimize-to-tray", (event, value) => {
  minimizeToTray = value;
});
ipcMain.on("lyric:update", (event, payload) => {
  const { currentLyric } = payload;
  if (process.platform === "darwin") {
    const displayTitle = currentLyric || (playerState.track ? `${playerState.track.name} - ${playerState.track.artist}` : "");
    trayNext?.setTitle(displayTitle);
  }
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
ipcMain.on("lyric:set-mouse-ignore", (event, ignore) => {
  lyricWin?.setIgnoreMouseEvents(ignore, { forward: true });
});
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
ipcMain.on("player:seek", (event, time) => {
  win?.webContents.send("player:seek", time);
});
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
ipcMain.on("window:set-always-on-top", (event, enable) => {
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
    alwaysOnTop: true,
    // Start always on top
    skipTaskbar: true,
    hasShadow: false,
    transparent: true,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  const miniUrl = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}#/mini` : `app://./index.html#/mini`;
  if (process.env.VITE_DEV_SERVER_URL) {
    miniWin.loadURL(miniUrl);
  } else {
    miniWin.loadURL(miniUrl);
  }
  if (process.platform === "darwin") {
    miniWin.setAlwaysOnTop(true, "floating");
    miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  miniWin.on("closed", () => {
    miniWin = null;
  });
}
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "logo.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "rgba(0,0,0,0)",
      symbolColor: "#ffffff",
      height: 30
    },
    width: 1020,
    // 初始宽度
    height: 700,
    // 初始高度
    minWidth: 1020,
    // 🔧 设置窗口最小宽度
    minHeight: 700,
    // 🔧 设置窗口最小高度
    transparent: process.platform === "darwin",
    opacity: 0.95,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: true,
      // 明确开启
      nodeIntegration: false,
      // 保持安全
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.on("close", (event) => {
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
function createLyricWindow(settings) {
  if (lyricWin) return;
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 800;
  const winHeight = 120;
  const x = settings?.x !== void 0 ? settings.x : Math.floor((screenWidth - winWidth) / 2);
  const y = settings?.y !== void 0 ? settings.y : screenHeight - winHeight - 50;
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
    hiddenInMissionControl: true,
    // Prevent Mission Control interference
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  const lyricUrl = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}#/lyric` : `${path.join(process.env.DIST, "index.html")}#/lyric`;
  if (process.env.VITE_DEV_SERVER_URL) {
    lyricWin.loadURL(lyricUrl);
  } else {
    lyricWin.loadURL("app://./index.html#/lyric");
  }
  if (process.platform === "darwin") {
    lyricWin.setAlwaysOnTop(true, "screen-saver");
    lyricWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  let moveTimeout = null;
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
function createTray() {
  const img = (name, size = 20) => {
    const icon = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, name));
    if (process.platform === "darwin") {
      icon.setTemplateImage(true);
    }
    return icon.resize({ width: size, height: size });
  };
  if (process.platform === "darwin") {
    trayNext = new Tray(img("next.png"));
    trayPlay = new Tray(img("play.png"));
    trayPrev = new Tray(img("previous.png"));
    trayMain = new Tray(img("mini_logo.png"));
    trayNext.on("click", () => win?.webContents.send("player:next"));
    trayPlay.on("click", () => win?.webContents.send("player:toggle"));
    trayPrev.on("click", () => win?.webContents.send("player:prev"));
  } else {
    const logoImg = nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC, "logo.png")).resize({ width: 24, height: 24 });
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
app.on("before-quit", () => {
  isQuitting = true;
});
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      corsEnabled: true
    }
  },
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
      // often needed for media elements
      stream: true
    }
  }
]);
app.whenReady().then(() => {
  console.log(`[Main] App is ready.`);
  console.log(`[Main] CACHE_DIR set to: ${CACHE_DIR}`);
  console.log(`[Main] Initial Download Path: ${currentDownloadPath || "Default (app/downloads)"}`);
  protocol.handle("app", (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith("/")) pathname = pathname.slice(1);
      const filePath = path.join(process.env.DIST, pathname || "index.html");
      console.log(`[Main] App Protocol: url=${request.url} -> filePath=${filePath}`);
      return net.fetch(pathToFileURL(filePath).href);
    } catch (e) {
      console.error("[Main] App protocol error:", e);
      return new Response("Internal error", { status: 500 });
    }
  });
  protocol.handle("media", async (request) => {
    try {
      const url = new URL(request.url);
      const host = url.host;
      let pathname = url.pathname;
      if (pathname.startsWith("/")) pathname = pathname.slice(1);
      const decodedPathname = decodeURIComponent(pathname);
      const getPath = (h, p) => {
        if (h === "audio") {
          const base = currentDownloadPath || path.join(app.getPath("userData"), "downloads");
          return path.join(base.replace(/^~/, os.homedir()), p);
        } else if (h === "cover" || h === "metadata") {
          return path.join(CACHE_DIR, p);
        } else {
          const base = currentDownloadPath || path.join(app.getPath("userData"), "audio_cache");
          return path.join(base.replace(/^~/, os.homedir()), h, p);
        }
      };
      let filePath = getPath(host, decodedPathname);
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
        return new Response("File Not Found", { status: 404 });
      }
      const ext = path.extname(filePath).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".mp3") contentType = "audio/mpeg";
      else if (ext === ".flac") contentType = "audio/flac";
      else if (ext === ".wav") contentType = "audio/wav";
      else if (ext === ".aac") contentType = "audio/aac";
      else if (ext === ".json") contentType = "application/json";
      if (ext === ".m4a") {
        const codec = await checkAudioCodec(filePath);
        if (codec === "alac") {
          console.log(`[Main] Detected ALAC codec for ${filePath}, transcoding to WAV...`);
          const ffmpeg = spawn("ffmpeg", ["-i", filePath, "-f", "wav", "-"]);
          return new Response(Readable.toWeb(ffmpeg.stdout), {
            headers: {
              "Content-Type": "audio/wav",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-cache"
            }
          });
        }
        contentType = "audio/mp4";
      }
      if (host === "cover" || host === "metadata" || ext === ".json" || ext === ".jpeg" || ext === ".jpg" || ext === ".png") {
        const fileData = fs.readFileSync(filePath);
        return new Response(fileData, {
          headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });
      }
      const fileUrl = pathToFileURL(filePath).href;
      const response = await net.fetch(fileUrl);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    } catch (e) {
      console.error("[Main] Protocol handle error:", e);
      return new Response("Internal error", { status: 500 });
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
