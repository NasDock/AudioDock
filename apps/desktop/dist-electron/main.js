import { spawn as q } from "child_process";
import { app as d, ipcMain as s, dialog as te, shell as k, net as L, screen as oe, BrowserWindow as V, protocol as M, Menu as F, nativeImage as U, Tray as E } from "electron";
import i from "fs";
import { fileURLToPath as ne, pathToFileURL as H } from "node:url";
import C from "os";
import a from "path";
import { Readable as Q } from "stream";
import { pipeline as re } from "stream/promises";
d.name = "AudioDock";
process.platform === "darwin" && (process.title = "AudioDock");
function ae() {
  const t = C.hostname().replace(/\.local$/, ""), e = process.platform;
  return e === "darwin" ? `${t}（Mac）` : e === "win32" ? `${t}（Windows）` : t;
}
const le = (t) => new Promise((e) => {
  const o = q("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    t
  ]);
  let r = "";
  o.stdout.on("data", (p) => r += p.toString()), o.on("close", () => e(r.trim())), o.on("error", (p) => {
    console.warn("ffprobe failed", p), e("");
  });
});
s.handle("get-device-name", () => ae());
s.handle("get-auto-launch", () => d.getLoginItemSettings().openAtLogin);
s.handle("player:get-state", () => y);
s.handle("set-auto-launch", (t, e) => {
  d.setLoginItemSettings({
    openAtLogin: e,
    path: process.execPath
  });
});
s.handle("select-directory", async () => {
  if (!n) return null;
  const t = await te.showOpenDialog(n, {
    properties: ["openDirectory"]
  });
  return t.canceled ? null : t.filePaths[0];
});
s.handle("open-url", (t, e) => (console.log("Opening URL:", e), k.openExternal(e)));
s.handle("open-directory", async (t, e) => {
  const o = e.replace(/^~/, C.homedir());
  if (!i.existsSync(o))
    try {
      i.mkdirSync(o, { recursive: !0 });
    } catch (r) {
      return console.error("Failed to create directory:", r), "Directory does not exist and could not be created";
    }
  return k.openPath(o);
});
const g = a.join(d.getPath("userData"), "audio_cache");
i.existsSync(g) || i.mkdirSync(g, { recursive: !0 });
const se = (t, e, o, r) => {
  const p = decodeURIComponent(r), b = a.basename(p), l = e === "MUSIC" ? "music" : a.join("audio", o.replace(/[/\\?%*:|"<>]/g, "-"));
  return {
    filePath: a.join(t.replace(/^~/, C.homedir()), l, b),
    relPath: a.join(l, b).replace(/\\/g, "/")
  };
}, x = /* @__PURE__ */ new Map();
s.handle("cache:check", async (t, e, o, r, p, b) => {
  const l = a.join(g, `${e}.json`);
  if (!i.existsSync(l)) return null;
  try {
    const m = JSON.parse(i.readFileSync(l, "utf8"));
    if (!m.localPath) return null;
    const c = a.join(r.replace(/^~/, C.homedir()), m.localPath);
    if (i.existsSync(c) && i.statSync(c).size > 0)
      return `media://audio/${m.localPath}`;
  } catch (m) {
    console.error("[Main] cache:check error", m);
  }
  return null;
});
s.handle("cache:download", async (t, e, o, r, p, b, l, m) => {
  if (x.has(e)) return x.get(e);
  const c = (async () => {
    let u = "";
    try {
      const { filePath: v, relPath: A } = se(r, p, b, new URL(o).pathname), w = a.dirname(v);
      if (i.existsSync(w) || i.mkdirSync(w, { recursive: !0 }), u = v + ".tmp", i.existsSync(v))
        return l.localPath = A, i.writeFileSync(a.join(g, `${e}.json`), JSON.stringify(l, null, 2)), `media://audio/${A}`;
      console.log(`[Main] Starting split download for track ${e}: ${o}`);
      const P = { "User-Agent": "SoundX-Desktop" };
      m && (P.Authorization = `Bearer ${m}`);
      const S = await L.fetch(o, { headers: P });
      if (!S.ok) throw new Error(`Fetch failed: ${S.status}`);
      const O = S.body;
      if (!O) throw new Error("Body empty");
      if (await re(Q.fromWeb(O), i.createWriteStream(u)), i.renameSync(u, v), l.cover)
        try {
          const R = l.cover;
          console.log(`[Main] Downloading cover: ${R}`);
          const ee = a.extname(new URL(R).pathname) || ".jpg", W = `${e}_cover${ee}`, j = await L.fetch(R);
          if (j.ok && j.body) {
            const B = j.headers.get("content-type");
            if (B && B.includes("text/html"))
              throw new Error("Received HTML instead of image (likely dev server fallback)");
            const z = await j.arrayBuffer(), N = Buffer.from(z.slice(0, 10)).toString();
            if (N.toLowerCase().includes("<!doc") || N.toLowerCase().includes("<html"))
              throw new Error("Response content looks like HTML");
            i.writeFileSync(a.join(g, W), Buffer.from(z)), l.cover = `media://cover/${W}`;
          }
        } catch (R) {
          console.error("[Main] Cover download failed:", R);
        }
      return l.localPath = A, i.writeFileSync(a.join(g, `${e}.json`), JSON.stringify(l, null, 2)), console.log(`[Main] Successfully cached/downloaded track ${e}`), `media://audio/${A}`;
    } catch (v) {
      if (console.error(`[Main] Split download failed for ${e}:`, v), u && i.existsSync(u)) try {
        i.unlinkSync(u);
      } catch {
      }
      return null;
    } finally {
      x.delete(e);
    }
  })();
  return x.set(e, c), c;
});
s.handle("cache:list", async (t, e, o) => {
  try {
    const r = [];
    if (!i.existsSync(g)) return [];
    const p = i.readdirSync(g);
    for (const b of p)
      if (b.endsWith(".json"))
        try {
          const l = JSON.parse(i.readFileSync(a.join(g, b), "utf8"));
          if (l.type === o) {
            const m = a.join(e.replace(/^~/, C.homedir()), l.localPath);
            i.existsSync(m) && r.push(l);
          }
        } catch {
        }
    return r;
  } catch (r) {
    return console.error("[Main] cache:list failed", r), [];
  }
});
let $ = "";
s.on("settings:update-download-path", (t, e) => {
  $ = e;
});
const D = a.dirname(ne(import.meta.url));
process.env.DIST = a.join(D, "../dist");
process.env.VITE_PUBLIC = d.isPackaged ? process.env.DIST : a.join(process.env.DIST, "../public");
let n = null, f = null, h = null, J = null, _ = null, Y = null, T = null, I = null, y = {
  isPlaying: !1,
  track: null
}, K = !0, X = !1;
function G(t = !0) {
  const e = y.isPlaying ? "pause.png" : "play.png";
  if (_) {
    const p = U.createFromPath(a.join(process.env.VITE_PUBLIC, e)).resize({ width: 18, height: 18 });
    process.platform === "darwin" && p.setTemplateImage(!0), _.setImage(p);
  }
  process.platform === "darwin" && t && (y.track ? I?.setTitle(`${y.track.name} - ${y.track.artist}`) : I?.setTitle(""));
  const o = [];
  y.track && o.push(
    { label: `♫ ${y.track.name}`, enabled: !1 },
    { label: `   ${y.track.artist}`, enabled: !1 },
    { type: "separator" },
    { label: "⏮ 上一曲", click: () => n?.webContents.send("player:prev") },
    {
      label: y.isPlaying ? "⏸ 暂停" : "▶️ 播放",
      click: () => n?.webContents.send("player:toggle")
    },
    { label: "⏭ 下一曲", click: () => n?.webContents.send("player:next") },
    { type: "separator" }
  ), o.push(
    { label: "打开播放器", click: () => n?.show() },
    { label: "退出", click: () => d.quit() }
  );
  const r = F.buildFromTemplate(o);
  T?.setContextMenu(r);
}
function ie() {
  const t = process.platform === "darwin", e = [
    ...t ? [
      {
        label: d.name,
        submenu: [
          { role: "about", label: `关于 ${d.name}` },
          { type: "separator" },
          { role: "services", label: "服务" },
          { type: "separator" },
          { role: "hide", label: `隐藏 ${d.name}` },
          { role: "hideOthers", label: "隐藏其他" },
          { role: "unhide", label: "显示全部" },
          { type: "separator" },
          { role: "quit", label: `退出 ${d.name}` }
        ]
      }
    ] : [],
    {
      label: "文件",
      submenu: [t ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" }]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        ...t ? [
          { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
          { role: "delete", label: "删除" },
          { role: "selectAll", label: "全选" },
          { type: "separator" },
          {
            label: "演讲",
            submenu: [
              { role: "startSpeaking", label: "开始朗读" },
              { role: "stopSpeaking", label: "停止朗读" }
            ]
          }
        ] : [
          { role: "delete", label: "删除" },
          { type: "separator" },
          { role: "selectAll", label: "全选" }
        ]
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        ...t ? [
          { type: "separator" },
          { role: "front", label: "前置全部窗口" },
          { type: "separator" },
          { role: "window", label: "窗口" }
        ] : [
          { role: "close", label: "关闭" }
        ]
      ]
    },
    {
      role: "help",
      label: "帮助",
      submenu: [
        {
          label: "项目主页",
          click: async () => {
            await k.openExternal("https://www.audiodock.cn");
          }
        },
        {
          label: "查看文档",
          click: async () => {
            await k.openExternal("https://www.audiodock.cn/docs");
          }
        },
        {
          label: "报告问题",
          click: async () => {
            await k.openExternal("https://github.com/mmdctjj/AudioDock/issues");
          }
        }
      ]
    }
  ], o = F.buildFromTemplate(e);
  F.setApplicationMenu(o);
}
s.on("player:update", (t, e) => {
  y = { ...y, ...e };
  const o = e.track !== void 0;
  G(o), f?.webContents.send("player:update", e), h?.webContents.send("player:update", e);
});
s.on("settings:update-minimize-to-tray", (t, e) => {
  K = e;
});
s.on("lyric:update", (t, e) => {
  const { currentLyric: o } = e;
  if (process.platform === "darwin") {
    const r = o || (y.track ? `${y.track.name} - ${y.track.artist}` : "");
    I?.setTitle(r);
  }
  f?.webContents.send("lyric:update", e), h?.webContents.send("lyric:update", e);
});
s.on("lyric:settings-update", (t, e) => {
  f?.webContents.send("lyric:settings-update", e);
});
s.on("lyric:open", (t, e) => {
  pe(e);
});
s.on("lyric:toggle", () => {
  n && n.webContents.send("lyric:toggle");
});
s.on("lyric:close", () => {
  f && (f.close(), f = null);
});
s.on("lyric:set-mouse-ignore", (t, e) => {
  f?.setIgnoreMouseEvents(e, { forward: !0 });
});
s.on("player:toggle", () => {
  console.log("Main process: received player:toggle"), n ? (console.log("Main process: forwarding player:toggle to main window"), n.webContents.send("player:toggle")) : console.warn("Main process: win is null, cannot forward player:toggle");
});
s.on("player:next", () => {
  console.log("Main process: received player:next"), n?.webContents.send("player:next");
});
s.on("player:prev", () => {
  n?.webContents.send("player:prev");
});
s.on("player:seek", (t, e) => {
  n?.webContents.send("player:seek", e);
});
s.on("window:set-mini", () => {
  n && (n.hide(), ce());
});
s.on("window:restore-main", () => {
  h && (h.close(), h = null), n && (n.show(), n.center());
});
s.on("app:show-main", () => {
  n && (n.isVisible() ? n.focus() : n.show());
});
s.on("window:set-always-on-top", (t, e) => {
  h && h.setAlwaysOnTop(e, "floating");
});
function ce() {
  if (h) {
    h.show();
    return;
  }
  h = new V({
    width: 360,
    height: 170,
    frame: !1,
    titleBarStyle: "hidden",
    resizable: !1,
    alwaysOnTop: !0,
    // Start always on top
    skipTaskbar: !0,
    hasShadow: !1,
    transparent: !0,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: !0,
      nodeIntegration: !1,
      preload: a.join(D, "preload.mjs")
    }
  });
  const t = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}#/mini` : "app://./index.html#/mini";
  process.env.VITE_DEV_SERVER_URL, h.loadURL(t), process.platform === "darwin" && (h.setAlwaysOnTop(!0, "floating"), h.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 })), h.on("closed", () => {
    h = null;
  });
}
function Z() {
  n = new V({
    icon: a.join(process.env.VITE_PUBLIC, "logo.png"),
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
    minWidth: 1025,
    // 🔧 设置窗口最小宽度
    minHeight: 700,
    // 🔧 设置窗口最小高度
    transparent: process.platform === "darwin",
    opacity: 0.95,
    vibrancy: "popover",
    visualEffectState: "active",
    webPreferences: {
      contextIsolation: !0,
      // 明确开启
      nodeIntegration: !1,
      // 保持安全
      preload: a.join(D, "preload.mjs")
    }
  }), n.on("close", (t) => (!X && K && (t.preventDefault(), n?.hide()), !1)), process.env.VITE_DEV_SERVER_URL ? n.loadURL(process.env.VITE_DEV_SERVER_URL) : n.loadURL("app://./index.html");
}
function pe(t) {
  if (f) return;
  const { width: e, height: o } = oe.getPrimaryDisplay().workAreaSize, r = 800, p = 120, b = t?.x !== void 0 ? t.x : Math.floor((e - r) / 2), l = t?.y !== void 0 ? t.y : o - p - 50;
  f = new V({
    width: r,
    height: p,
    x: b,
    y: l,
    frame: !1,
    transparent: !0,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    resizable: !0,
    hasShadow: !1,
    hiddenInMissionControl: !0,
    // Prevent Mission Control interference
    webPreferences: {
      contextIsolation: !0,
      nodeIntegration: !1,
      preload: a.join(D, "preload.mjs")
    }
  });
  const m = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}#/lyric` : `${a.join(process.env.DIST, "index.html")}#/lyric`;
  process.env.VITE_DEV_SERVER_URL ? f.loadURL(m) : f.loadURL("app://./index.html#/lyric"), process.platform === "darwin" && (f.setAlwaysOnTop(!0, "screen-saver"), f.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }));
  let c = null;
  f.on("move", () => {
    c && clearTimeout(c), c = setTimeout(() => {
      if (f && n) {
        const [u, v] = f.getPosition();
        n.webContents.send("lyric:position-updated", { x: u, y: v });
      }
    }, 500);
  }), f.on("closed", () => {
    f = null;
  });
}
function de() {
  const t = (e, o = 20) => {
    let r = U.createFromPath(a.join(process.env.VITE_PUBLIC, e));
    return r = r.resize({ width: o, height: o }), process.platform === "darwin" && r.setTemplateImage(!0), r;
  };
  if (process.platform === "darwin") {
    const e = U.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");
    I = new E(e), I.on("click", () => {
      n?.webContents.send("lyric:toggle");
    }), Y = new E(t("next.png")), _ = new E(t("play.png")), J = new E(t("previous.png")), T = new E(t("mini_logo.png")), Y.on("click", () => n?.webContents.send("player:next")), _.on("click", () => n?.webContents.send("player:toggle")), J.on("click", () => n?.webContents.send("player:prev"));
  } else {
    const e = U.createFromPath(a.join(process.env.VITE_PUBLIC, "logo.png")).resize({ width: 24, height: 24 });
    T = new E(e), T.setToolTip("AudioDock");
  }
  T.on("click", () => {
    n && (n.isVisible() ? n.focus() : n.show());
  }), G();
}
d.on("before-quit", () => {
  X = !0;
});
M.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: !0,
      secure: !0,
      supportFetchAPI: !0,
      bypassCSP: !1,
      corsEnabled: !0
    }
  },
  {
    scheme: "media",
    privileges: {
      standard: !0,
      secure: !0,
      supportFetchAPI: !0,
      bypassCSP: !0,
      corsEnabled: !0,
      // often needed for media elements
      stream: !0
    }
  }
]);
d.whenReady().then(() => {
  console.log("[Main] App is ready."), process.platform === "darwin" && d.setAboutPanelOptions({
    applicationName: "AudioDock",
    applicationVersion: d.getVersion(),
    version: d.getVersion(),
    copyright: "Copyright © 2026 北京声仓科技有限公司",
    website: "https://www.audiodock.cn",
    iconPath: a.join(process.env.VITE_PUBLIC, "logo.png")
  }), console.log(`[Main] CACHE_DIR set to: ${g}`), console.log(`[Main] Initial Download Path: ${$ || "Default (app/downloads)"}`), M.handle("app", (t) => {
    try {
      const e = new URL(t.url);
      let o = decodeURIComponent(e.pathname);
      o.startsWith("/") && (o = o.slice(1));
      const r = a.join(process.env.DIST, o || "index.html");
      return console.log(`[Main] App Protocol: url=${t.url} -> filePath=${r}`), L.fetch(H(r).href);
    } catch (e) {
      return console.error("[Main] App protocol error:", e), new Response("Internal error", { status: 500 });
    }
  }), M.handle("media", async (t) => {
    try {
      const e = new URL(t.url), o = e.host;
      let r = e.pathname;
      r.startsWith("/") && (r = r.slice(1));
      const p = decodeURIComponent(r);
      let l = ((w, P) => {
        if (w === "audio") {
          const S = $ || a.join(d.getPath("userData"), "downloads");
          return a.join(S.replace(/^~/, C.homedir()), P);
        } else {
          if (w === "cover" || w === "metadata")
            return a.join(g, P);
          {
            const S = $ || a.join(d.getPath("userData"), "audio_cache");
            return a.join(S.replace(/^~/, C.homedir()), w, P);
          }
        }
      })(o, p);
      if (!i.existsSync(l)) {
        const w = a.join(g, p || o);
        i.existsSync(w) && (console.log(`[Main] File found via CACHEFallback: ${w}`), l = w);
      }
      const m = i.existsSync(l);
      if (console.log(`[Main] Media Protocol: url=${t.url} -> host=${o}, path=${p} -> filePath=${l} (exists: ${m})`), !m)
        return new Response("File Not Found", { status: 404 });
      const c = a.extname(l).toLowerCase();
      let u = "application/octet-stream";
      if (c === ".jpg" || c === ".jpeg" ? u = "image/jpeg" : c === ".png" ? u = "image/png" : c === ".mp3" ? u = "audio/mpeg" : c === ".flac" ? u = "audio/flac" : c === ".wav" ? u = "audio/wav" : c === ".aac" ? u = "audio/aac" : c === ".json" && (u = "application/json"), c === ".m4a") {
        if (await le(l) === "alac") {
          console.log(`[Main] Detected ALAC codec for ${l}, transcoding to WAV...`);
          const P = q("ffmpeg", ["-i", l, "-f", "wav", "-"]);
          return new Response(Q.toWeb(P.stdout), {
            headers: {
              "Content-Type": "audio/wav",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-cache"
            }
          });
        }
        u = "audio/mp4";
      }
      if (o === "cover" || o === "metadata" || c === ".json" || c === ".jpeg" || c === ".jpg" || c === ".png") {
        const w = i.readFileSync(l);
        return new Response(new Uint8Array(w), {
          headers: {
            "Content-Type": u,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });
      }
      const v = H(l).href, A = await L.fetch(v);
      return new Response(A.body, {
        status: A.status,
        statusText: A.statusText,
        headers: {
          "Content-Type": u,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    } catch (e) {
      return console.error("[Main] Protocol handle error:", e), new Response("Internal error", { status: 500 });
    }
  }), Z(), de(), ie();
});
d.on("window-all-closed", () => {
  process.platform !== "darwin" && d.quit();
});
d.on("activate", () => {
  V.getAllWindows().length === 0 ? Z() : n?.show();
});
