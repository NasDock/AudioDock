import { spawn as H } from "child_process";
import { ipcMain as l, app as y, dialog as Z, shell as J, net as $, screen as ee, BrowserWindow as U, protocol as V, Menu as te, Tray as E, nativeImage as A } from "electron";
import i from "fs";
import { fileURLToPath as ne, pathToFileURL as N } from "node:url";
import T from "os";
import a from "path";
import { Readable as X } from "stream";
import { pipeline as oe } from "stream/promises";
function re() {
  const t = T.hostname().replace(/\.local$/, ""), e = process.platform;
  return e === "darwin" ? `${t}（Mac）` : e === "win32" ? `${t}（Windows）` : t;
}
const ae = (t) => new Promise((e) => {
  const n = H("ffprobe", [
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
  n.stdout.on("data", (p) => r += p.toString()), n.on("close", () => e(r.trim())), n.on("error", (p) => {
    console.warn("ffprobe failed", p), e("");
  });
});
l.handle("get-device-name", () => re());
l.handle("get-auto-launch", () => y.getLoginItemSettings().openAtLogin);
l.handle("player:get-state", () => w);
l.handle("set-auto-launch", (t, e) => {
  y.setLoginItemSettings({
    openAtLogin: e,
    path: process.execPath
  });
});
l.handle("select-directory", async () => {
  if (!o) return null;
  const t = await Z.showOpenDialog(o, {
    properties: ["openDirectory"]
  });
  return t.canceled ? null : t.filePaths[0];
});
l.handle("open-url", (t, e) => (console.log("Opening URL:", e), J.openExternal(e)));
l.handle("open-directory", async (t, e) => {
  const n = e.replace(/^~/, T.homedir());
  if (!i.existsSync(n))
    try {
      i.mkdirSync(n, { recursive: !0 });
    } catch (r) {
      return console.error("Failed to create directory:", r), "Directory does not exist and could not be created";
    }
  return J.openPath(n);
});
const g = a.join(y.getPath("userData"), "audio_cache");
i.existsSync(g) || i.mkdirSync(g, { recursive: !0 });
const se = (t, e, n, r) => {
  const p = decodeURIComponent(r), v = a.basename(p), s = e === "MUSIC" ? "music" : a.join("audio", n.replace(/[/\\?%*:|"<>]/g, "-"));
  return {
    filePath: a.join(t.replace(/^~/, T.homedir()), s, v),
    relPath: a.join(s, v).replace(/\\/g, "/")
  };
}, _ = /* @__PURE__ */ new Map();
l.handle("cache:check", async (t, e, n, r, p, v) => {
  const s = a.join(g, `${e}.json`);
  if (!i.existsSync(s)) return null;
  try {
    const h = JSON.parse(i.readFileSync(s, "utf8"));
    if (!h.localPath) return null;
    const c = a.join(r.replace(/^~/, T.homedir()), h.localPath);
    if (i.existsSync(c) && i.statSync(c).size > 0)
      return `media://audio/${h.localPath}`;
  } catch (h) {
    console.error("[Main] cache:check error", h);
  }
  return null;
});
l.handle("cache:download", async (t, e, n, r, p, v, s, h) => {
  if (_.has(e)) return _.get(e);
  const c = (async () => {
    let d = "";
    try {
      const { filePath: b, relPath: P } = se(r, p, v, new URL(n).pathname), m = a.dirname(b);
      if (i.existsSync(m) || i.mkdirSync(m, { recursive: !0 }), d = b + ".tmp", i.existsSync(b))
        return s.localPath = P, i.writeFileSync(a.join(g, `${e}.json`), JSON.stringify(s, null, 2)), `media://audio/${P}`;
      console.log(`[Main] Starting split download for track ${e}: ${n}`);
      const S = { "User-Agent": "SoundX-Desktop" };
      h && (S.Authorization = `Bearer ${h}`);
      const C = await $.fetch(n, { headers: S });
      if (!C.ok) throw new Error(`Fetch failed: ${C.status}`);
      const D = C.body;
      if (!D) throw new Error("Body empty");
      if (await oe(X.fromWeb(D), i.createWriteStream(d)), i.renameSync(d, b), s.cover)
        try {
          const R = s.cover;
          console.log(`[Main] Downloading cover: ${R}`);
          const K = a.extname(new URL(R).pathname) || ".jpg", F = `${e}_cover${K}`, I = await $.fetch(R);
          if (I.ok && I.body) {
            const W = I.headers.get("content-type");
            if (W && W.includes("text/html"))
              throw new Error("Received HTML instead of image (likely dev server fallback)");
            const O = await I.arrayBuffer(), B = Buffer.from(O.slice(0, 10)).toString();
            if (B.toLowerCase().includes("<!doc") || B.toLowerCase().includes("<html"))
              throw new Error("Response content looks like HTML");
            i.writeFileSync(a.join(g, F), Buffer.from(O)), s.cover = `media://cover/${F}`;
          }
        } catch (R) {
          console.error("[Main] Cover download failed:", R);
        }
      return s.localPath = P, i.writeFileSync(a.join(g, `${e}.json`), JSON.stringify(s, null, 2)), console.log(`[Main] Successfully cached/downloaded track ${e}`), `media://audio/${P}`;
    } catch (b) {
      if (console.error(`[Main] Split download failed for ${e}:`, b), d && i.existsSync(d)) try {
        i.unlinkSync(d);
      } catch {
      }
      return null;
    } finally {
      _.delete(e);
    }
  })();
  return _.set(e, c), c;
});
l.handle("cache:list", async (t, e, n) => {
  try {
    const r = [];
    if (!i.existsSync(g)) return [];
    const p = i.readdirSync(g);
    for (const v of p)
      if (v.endsWith(".json"))
        try {
          const s = JSON.parse(i.readFileSync(a.join(g, v), "utf8"));
          if (s.type === n) {
            const h = a.join(e.replace(/^~/, T.homedir()), s.localPath);
            i.existsSync(h) && r.push(s);
          }
        } catch {
        }
    return r;
  } catch (r) {
    return console.error("[Main] cache:list failed", r), [];
  }
});
let k = "";
l.on("settings:update-download-path", (t, e) => {
  k = e;
});
const M = a.dirname(ne(import.meta.url));
process.env.DIST = a.join(M, "../dist");
process.env.VITE_PUBLIC = y.isPackaged ? process.env.DIST : a.join(process.env.DIST, "../public");
let o = null, u = null, f = null, z = null, L = null, x = null, j = null, w = {
  isPlaying: !1,
  track: null
}, q = !0, Q = !1;
function Y(t = !0) {
  const e = w.isPlaying ? "pause.png" : "play.png";
  if (L) {
    const p = A.createFromPath(a.join(process.env.VITE_PUBLIC, e)).resize({ width: 18, height: 18 });
    process.platform === "darwin" && p.setTemplateImage(!0), L.setImage(p);
  }
  process.platform === "darwin" && t && (w.track ? x?.setTitle(`${w.track.name} - ${w.track.artist}`) : x?.setTitle(""));
  const n = [];
  w.track && n.push(
    { label: `♫ ${w.track.name}`, enabled: !1 },
    { label: `   ${w.track.artist}`, enabled: !1 },
    { type: "separator" },
    { label: "⏮ 上一曲", click: () => o?.webContents.send("player:prev") },
    {
      label: w.isPlaying ? "⏸ 暂停" : "▶️ 播放",
      click: () => o?.webContents.send("player:toggle")
    },
    { label: "⏭ 下一曲", click: () => o?.webContents.send("player:next") },
    { type: "separator" }
  ), n.push(
    { label: "打开播放器", click: () => o?.show() },
    { label: "退出", click: () => y.quit() }
  );
  const r = te.buildFromTemplate(n);
  j?.setContextMenu(r);
}
l.on("player:update", (t, e) => {
  w = { ...w, ...e };
  const n = e.track !== void 0;
  Y(n), u?.webContents.send("player:update", e), f?.webContents.send("player:update", e);
});
l.on("settings:update-minimize-to-tray", (t, e) => {
  q = e;
});
l.on("lyric:update", (t, e) => {
  const { currentLyric: n } = e;
  if (process.platform === "darwin") {
    const r = n || (w.track ? `${w.track.name} - ${w.track.artist}` : "");
    x?.setTitle(r);
  }
  u?.webContents.send("lyric:update", e), f?.webContents.send("lyric:update", e);
});
l.on("lyric:settings-update", (t, e) => {
  u?.webContents.send("lyric:settings-update", e);
});
l.on("lyric:open", (t, e) => {
  le(e);
});
l.on("lyric:close", () => {
  u && (u.close(), u = null);
});
l.on("lyric:set-mouse-ignore", (t, e) => {
  u?.setIgnoreMouseEvents(e, { forward: !0 });
});
l.on("player:toggle", () => {
  console.log("Main process: received player:toggle"), o ? (console.log("Main process: forwarding player:toggle to main window"), o.webContents.send("player:toggle")) : console.warn("Main process: win is null, cannot forward player:toggle");
});
l.on("player:next", () => {
  console.log("Main process: received player:next"), o?.webContents.send("player:next");
});
l.on("player:prev", () => {
  o?.webContents.send("player:prev");
});
l.on("player:seek", (t, e) => {
  o?.webContents.send("player:seek", e);
});
l.on("window:set-mini", () => {
  o && (o.hide(), ie());
});
l.on("window:restore-main", () => {
  f && (f.close(), f = null), o && (o.show(), o.center());
});
l.on("app:show-main", () => {
  o && (o.isVisible() ? o.focus() : o.show());
});
l.on("window:set-always-on-top", (t, e) => {
  f && f.setAlwaysOnTop(e, "floating");
});
function ie() {
  if (f) {
    f.show();
    return;
  }
  f = new U({
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
      preload: a.join(M, "preload.mjs")
    }
  });
  const t = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}#/mini` : "app://./index.html#/mini";
  process.env.VITE_DEV_SERVER_URL, f.loadURL(t), process.platform === "darwin" && (f.setAlwaysOnTop(!0, "floating"), f.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 })), f.on("closed", () => {
    f = null;
  });
}
function G() {
  o = new U({
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
    minWidth: 1020,
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
      preload: a.join(M, "preload.mjs")
    }
  }), o.on("close", (t) => (!Q && q && (t.preventDefault(), o?.hide()), !1)), process.env.VITE_DEV_SERVER_URL ? o.loadURL(process.env.VITE_DEV_SERVER_URL) : o.loadURL("app://./index.html");
}
function le(t) {
  if (u) return;
  const { width: e, height: n } = ee.getPrimaryDisplay().workAreaSize, r = 800, p = 120, v = t?.x !== void 0 ? t.x : Math.floor((e - r) / 2), s = t?.y !== void 0 ? t.y : n - p - 50;
  u = new U({
    width: r,
    height: p,
    x: v,
    y: s,
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
      preload: a.join(M, "preload.mjs")
    }
  });
  const h = process.env.VITE_DEV_SERVER_URL ? `${process.env.VITE_DEV_SERVER_URL}#/lyric` : `${a.join(process.env.DIST, "index.html")}#/lyric`;
  process.env.VITE_DEV_SERVER_URL ? u.loadURL(h) : u.loadURL("app://./index.html#/lyric"), process.platform === "darwin" && (u.setAlwaysOnTop(!0, "screen-saver"), u.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }));
  let c = null;
  u.on("move", () => {
    c && clearTimeout(c), c = setTimeout(() => {
      if (u && o) {
        const [d, b] = u.getPosition();
        o.webContents.send("lyric:position-updated", { x: d, y: b });
      }
    }, 500);
  }), u.on("closed", () => {
    u = null;
  });
}
function ce() {
  const t = (e, n = 20) => {
    const r = A.createFromPath(a.join(process.env.VITE_PUBLIC, e));
    return process.platform === "darwin" && r.setTemplateImage(!0), r.resize({ width: n, height: n });
  };
  if (process.platform === "darwin")
    x = new E(t("next.png")), L = new E(t("play.png")), z = new E(t("previous.png")), j = new E(t("mini_logo.png")), x.on("click", () => o?.webContents.send("player:next")), L.on("click", () => o?.webContents.send("player:toggle")), z.on("click", () => o?.webContents.send("player:prev"));
  else {
    const e = A.createFromPath(a.join(process.env.VITE_PUBLIC, "logo.png")).resize({ width: 24, height: 24 });
    j = new E(e), j.setToolTip("AudioDock");
  }
  j.on("click", () => {
    o && (o.isVisible() ? o.focus() : o.show());
  }), Y();
}
y.on("before-quit", () => {
  Q = !0;
});
V.registerSchemesAsPrivileged([
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
y.whenReady().then(() => {
  console.log("[Main] App is ready."), console.log(`[Main] CACHE_DIR set to: ${g}`), console.log(`[Main] Initial Download Path: ${k || "Default (app/downloads)"}`), V.handle("app", (t) => {
    try {
      const e = new URL(t.url);
      let n = decodeURIComponent(e.pathname);
      n.startsWith("/") && (n = n.slice(1));
      const r = a.join(process.env.DIST, n || "index.html");
      return console.log(`[Main] App Protocol: url=${t.url} -> filePath=${r}`), $.fetch(N(r).href);
    } catch (e) {
      return console.error("[Main] App protocol error:", e), new Response("Internal error", { status: 500 });
    }
  }), V.handle("media", async (t) => {
    try {
      const e = new URL(t.url), n = e.host;
      let r = e.pathname;
      r.startsWith("/") && (r = r.slice(1));
      const p = decodeURIComponent(r);
      let s = ((m, S) => {
        if (m === "audio") {
          const C = k || a.join(y.getPath("userData"), "downloads");
          return a.join(C.replace(/^~/, T.homedir()), S);
        } else {
          if (m === "cover" || m === "metadata")
            return a.join(g, S);
          {
            const C = k || a.join(y.getPath("userData"), "audio_cache");
            return a.join(C.replace(/^~/, T.homedir()), m, S);
          }
        }
      })(n, p);
      if (!i.existsSync(s)) {
        const m = a.join(g, p || n);
        i.existsSync(m) && (console.log(`[Main] File found via CACHEFallback: ${m}`), s = m);
      }
      const h = i.existsSync(s);
      if (console.log(`[Main] Media Protocol: url=${t.url} -> host=${n}, path=${p} -> filePath=${s} (exists: ${h})`), !h)
        return new Response("File Not Found", { status: 404 });
      const c = a.extname(s).toLowerCase();
      let d = "application/octet-stream";
      if (c === ".jpg" || c === ".jpeg" ? d = "image/jpeg" : c === ".png" ? d = "image/png" : c === ".mp3" ? d = "audio/mpeg" : c === ".flac" ? d = "audio/flac" : c === ".wav" ? d = "audio/wav" : c === ".aac" ? d = "audio/aac" : c === ".json" && (d = "application/json"), c === ".m4a") {
        if (await ae(s) === "alac") {
          console.log(`[Main] Detected ALAC codec for ${s}, transcoding to WAV...`);
          const S = H("ffmpeg", ["-i", s, "-f", "wav", "-"]);
          return new Response(X.toWeb(S.stdout), {
            headers: {
              "Content-Type": "audio/wav",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-cache"
            }
          });
        }
        d = "audio/mp4";
      }
      if (n === "cover" || n === "metadata" || c === ".json" || c === ".jpeg" || c === ".jpg" || c === ".png") {
        const m = i.readFileSync(s);
        return new Response(m, {
          headers: {
            "Content-Type": d,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });
      }
      const b = N(s).href, P = await $.fetch(b);
      return new Response(P.body, {
        status: P.status,
        statusText: P.statusText,
        headers: {
          "Content-Type": d,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    } catch (e) {
      return console.error("[Main] Protocol handle error:", e), new Response("Internal error", { status: 500 });
    }
  }), G(), ce();
});
y.on("window-all-closed", () => {
  process.platform !== "darwin" && y.quit();
});
y.on("activate", () => {
  U.getAllWindows().length === 0 ? G() : o?.show();
});
