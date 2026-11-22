"use strict";

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  Notification,
  dialog,
  globalShortcut,
  shell,
  screen,
  session
} = require("electron");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const APP_ID = "com.missionmap.app";
const PREFERRED_PORT = 45719;
const MINI_WIDTH = 372;
const MINI_HEIGHT = 540;
const DEFAULT_WIDTH = 1220;
const DEFAULT_HEIGHT = 840;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm"
};

app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let assetServer = null;
let serverUrl = "";
let isQuitting = false;
let currentEvilMode = false;
let currentTitle = "Mission Map";
let currentTooltip = "Mission Map";
let currentIconImage = null;
let currentTrayStatus = { openCount: 0, doneCount: 0, totalCount: 0, expiredCount: 0, pomoState: "" };
let trayHintShown = false;

let prefs = {
  bounds: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, x: null, y: null },
  miniBounds: null,
  maximized: false,
  miniMode: false,
  alwaysOnTop: false,
  minimizeToTray: true,
  evilMode: false
};

function resolveWwwDir() {
  const packagedWww = path.join(__dirname, "app-www");
  const rootWww = path.resolve(__dirname, "..", "www");
  if (app.isPackaged && fs.existsSync(packagedWww)) return packagedWww;
  if (fs.existsSync(rootWww)) return rootWww;
  return packagedWww;
}

function resolveDefaultIconPath(evil) {
  const wwwDir = resolveWwwDir();
  const rel = evil ? path.join("pins", "base-evil-256.png") : path.join("pins", "base-smile-256.png");
  const candidate = path.join(wwwDir, rel);
  if (fs.existsSync(candidate)) return candidate;
  const buildPng = path.join(__dirname, "build", "icon.png");
  if (fs.existsSync(buildPng)) return buildPng;
  return "";
}

function loadDefaultIcon(evil) {
  const p = resolveDefaultIconPath(!!evil);
  if (!p) return nativeImage.createEmpty();
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function prefsFilePath() {
  return path.join(app.getPath("userData"), "desktop-prefs.json");
}

function loadPrefs() {
  try {
    const raw = fs.readFileSync(prefsFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.bounds && typeof parsed.bounds === "object") {
        prefs.bounds = {
          width: Math.max(360, Number(parsed.bounds.width) || DEFAULT_WIDTH),
          height: Math.max(420, Number(parsed.bounds.height) || DEFAULT_HEIGHT),
          x: Number.isFinite(parsed.bounds.x) ? parsed.bounds.x : null,
          y: Number.isFinite(parsed.bounds.y) ? parsed.bounds.y : null
        };
      }
      if (parsed.miniBounds && typeof parsed.miniBounds === "object") {
        prefs.miniBounds = {
          width: Math.max(320, Math.min(520, Number(parsed.miniBounds.width) || MINI_WIDTH)),
          height: Math.max(360, Math.min(820, Number(parsed.miniBounds.height) || MINI_HEIGHT)),
          x: Number.isFinite(parsed.miniBounds.x) ? parsed.miniBounds.x : null,
          y: Number.isFinite(parsed.miniBounds.y) ? parsed.miniBounds.y : null
        };
      }
      prefs.maximized = !!parsed.maximized;
      prefs.miniMode = !!parsed.miniMode;
      prefs.alwaysOnTop = !!parsed.alwaysOnTop;
      prefs.minimizeToTray = parsed.minimizeToTray !== false;
      prefs.evilMode = !!parsed.evilMode;
      currentEvilMode = prefs.evilMode;
    }
  } catch (_err) {}
}

function savePrefs() {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(prefsFilePath(), JSON.stringify(prefs, null, 2), "utf8");
  } catch (_err) {}
}

function clampBoundsToWorkArea(b) {
  const display = Number.isFinite(b.x) && Number.isFinite(b.y)
    ? screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height })
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  let x = Number.isFinite(b.x) ? b.x : Math.round(wa.x + (wa.width - width) / 2);
  let y = Number.isFinite(b.y) ? b.y : Math.round(wa.y + (wa.height - height) / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - height));
  return { x, y, width, height };
}

function getDesktopState() {
  return {
    miniMode: !!prefs.miniMode,
    alwaysOnTop: !!(prefs.miniMode || prefs.alwaysOnTop),
    minimizeToTray: !!prefs.minimizeToTray,
    evilMode: !!currentEvilMode
  };
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:state", getDesktopState());
  }
  rebuildTrayMenu();
}

function sendRendererCommand(command, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:command", { command, payload: payload || null });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  rebuildTrayMenu();
}

function applyMiniMode(enable) {
  const next = !!enable;
  if (!mainWindow || mainWindow.isDestroyed()) {
    prefs.miniMode = next;
    savePrefs();
    return getDesktopState();
  }
  if (next === prefs.miniMode) {
    return getDesktopState();
  }

  if (next) {
    prefs.maximized = mainWindow.isMaximized();
    if (prefs.maximized) mainWindow.unmaximize();
    prefs.bounds = mainWindow.getBounds();
    prefs.miniMode = true;

    const wa = screen.getDisplayMatching(prefs.bounds).workArea;
    const rawMini = prefs.miniBounds || {
      width: MINI_WIDTH,
      height: MINI_HEIGHT,
      x: wa.x + wa.width - MINI_WIDTH - 20,
      y: wa.y + wa.height - MINI_HEIGHT - 20
    };
    const clamped = clampBoundsToWorkArea(rawMini);
    mainWindow.setMinimumSize(320, 380);
    mainWindow.setBounds(clamped);
    mainWindow.setAlwaysOnTop(true, "floating");
  } else {
    prefs.miniBounds = mainWindow.getBounds();
    prefs.miniMode = false;
    mainWindow.setAlwaysOnTop(!!prefs.alwaysOnTop, "floating");
    mainWindow.setMinimumSize(360, 420);
    const clampedNormal = clampBoundsToWorkArea(prefs.bounds);
    mainWindow.setBounds(clampedNormal);
    if (prefs.maximized) mainWindow.maximize();
  }

  savePrefs();
  broadcastState();
  return getDesktopState();
}

function setAlwaysOnTop(enable) {
  prefs.alwaysOnTop = !!enable;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const activeTop = prefs.miniMode || prefs.alwaysOnTop;
    mainWindow.setAlwaysOnTop(activeTop, "floating");
  }
  savePrefs();
  broadcastState();
  return getDesktopState();
}

function setMinimizeToTray(enable) {
  prefs.minimizeToTray = !!enable;
  savePrefs();
  broadcastState();
  return getDesktopState();
}

function formatTrayStatusLabel() {
  const modeTxt = currentEvilMode ? "Don't-do List" : "Do List";
  const st = currentTrayStatus || {};
  let countTxt = "Ready";
  if (st.totalCount > 0) {
    countTxt = st.openCount > 0 ? `${st.openCount} open` : "All done";
    if (st.expiredCount > 0) countTxt += ` (${st.expiredCount} due)`;
  }
  const pomoTxt = st.pomoState ? ` · Pomodoro: ${st.pomoState}` : "";
  return `${modeTxt} · ${countTxt}${pomoTxt}`;
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const winVisible = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const menu = Menu.buildFromTemplate([
    {
      label: formatTrayStatusLabel(),
      enabled: false
    },
    { type: "separator" },
    {
      label: winVisible ? "Hide to Tray" : "Open Mission Map",
      click: () => {
        if (winVisible) mainWindow.hide();
        else showWindow();
        rebuildTrayMenu();
      }
    },
    {
      label: "Quick Add Mission (Ctrl+Shift+A)",
      click: () => {
        showWindow();
        sendRendererCommand("add-mission");
      }
    },
    {
      label: "Always-on-Top Mini Mode (Ctrl+Shift+M)",
      type: "checkbox",
      checked: !!prefs.miniMode,
      click: () => {
        if (!prefs.miniMode) showWindow();
        applyMiniMode(!prefs.miniMode);
      }
    },
    {
      label: "Always on Top",
      type: "checkbox",
      checked: !!(prefs.miniMode || prefs.alwaysOnTop),
      enabled: !prefs.miniMode,
      click: () => setAlwaysOnTop(!prefs.alwaysOnTop)
    },
    {
      label: (currentEvilMode ? "Switch to Do List" : "Switch to Don't-do List") + " (Ctrl+Shift+D)",
      click: () => {
        sendRendererCommand("toggle-evil");
      }
    },
    {
      label: "Start / Pause Pomodoro (Ctrl+Shift+P)",
      click: () => {
        sendRendererCommand("toggle-pomo");
      }
    },
    {
      label: "Export Town Map PNG (Ctrl+E)",
      click: () => {
        showWindow();
        sendRendererCommand("export-png");
      }
    },
    {
      label: "Keyboard Shortcuts (?)",
      click: () => {
        showWindow();
        sendRendererCommand("show-shortcuts");
      }
    },
    { type: "separator" },
    {
      label: "Minimize to Tray on Close",
      type: "checkbox",
      checked: !!prefs.minimizeToTray,
      click: () => setMinimizeToTray(!prefs.minimizeToTray)
    },
    { type: "separator" },
    {
      label: "Quit Mission Map",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
}

function isAllowedOAuthPopupUrl(rawUrl) {
  if (rawUrl === "about:blank") return true;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "accounts.google.com" ||
      h === "myaccount.google.com" ||
      h === "gds.google.com" ||
      h === "gen-lang-client-0300203338.firebaseapp.com" ||
      h.endsWith(".firebaseapp.com") ||
      h.endsWith(".web.app")
    );
  } catch (_err) {
    return false;
  }
}

function isSafeExternalUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch (_err) {
    return false;
  }
}

function isAllowedGoogleIcalUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    return u.protocol === "https:" && u.hostname === "calendar.google.com" && u.pathname.startsWith("/calendar/ical/");
  } catch (_e) {
    return false;
  }
}

function handleIcalProxy(reqUrl, res) {
  const target = (reqUrl.searchParams.get("url") || "").trim();
  if (!isAllowedGoogleIcalUrl(target)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Only https://calendar.google.com/calendar/ical/ URLs are allowed.");
    return;
  }
  const req = https.get(target, { headers: { "Accept": "text/calendar,text/plain;q=0.9,*/*;q=0.8" } }, (up) => {
    if (up.statusCode && up.statusCode >= 400) {
      res.writeHead(up.statusCode, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Upstream error: HTTP " + up.statusCode);
      up.resume();
      return;
    }
    const chunks = [];
    let total = 0;
    up.on("data", (c) => {
      total += c.length;
      if (total > 2 * 1024 * 1024) {
        req.destroy();
        if (!res.headersSent) res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Calendar feed too large.");
        return;
      }
      chunks.push(c);
    });
    up.on("end", () => {
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" });
        res.end(Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
  req.setTimeout(10000, () => { req.destroy(new Error("Request timed out")); });
  req.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(err && err.message ? err.message : "Failed to fetch calendar feed.");
    }
  });
}

function startAssetServer() {
  const wwwDir = resolveWwwDir();
  const rootResolved = path.resolve(wwwDir);

  return new Promise((resolve, reject) => {
    const createSrv = () => http.createServer((req, res) => {
      const reqUrl = new URL(req.url || "/", "http://localhost");
      let pathname = "/";
      try {
        pathname = decodeURIComponent(reqUrl.pathname || "/");
      } catch (_err) {
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }
      if (pathname === "/api/ical-proxy" && req.method === "GET") {
        handleIcalProxy(reqUrl, res);
        return;
      }
      if (pathname === "/") pathname = "/index.html";
      const rel = pathname.replace(/^\/+/, "");
      let filePath = path.resolve(rootResolved, rel);
      if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          filePath = path.join(rootResolved, "index.html");
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
        });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    const listenOnHost = (s, port, host, onSuccess, onError) => {
      s.once("error", onError);
      s.listen(port, host, () => {
        s.removeListener("error", onError);
        assetServer = s;
        const addr = s.address();
        onSuccess("http://localhost:" + addr.port);
      });
    };

    const srv = createSrv();
    const tryListen = (port, host, allowPortFallback) => {
      listenOnHost(srv, port, host, resolve, (err) => {
        if ((err.code === "EADDRNOTAVAIL" || err.code === "ENOTFOUND") && host === "localhost") {
          const fallbackIpSrv = createSrv();
          listenOnHost(fallbackIpSrv, port, "127.0.0.1", resolve, (err2) => {
            if (allowPortFallback && (err2.code === "EADDRINUSE" || err2.code === "EACCES")) {
              const randSrv = createSrv();
              listenOnHost(randSrv, 0, "127.0.0.1", resolve, reject);
            } else {
              reject(err2);
            }
          });
        } else if (allowPortFallback && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
          const fallbackSrv = createSrv();
          listenOnHost(fallbackSrv, 0, host, resolve, reject);
        } else {
          reject(err);
        }
      });
    };

    tryListen(PREFERRED_PORT, "localhost", true);
  });
}

function updateAppIcons(payload) {
  const evil = !!(payload && payload.evil);
  const label = payload && typeof payload.label === "string" && payload.label.trim()
    ? payload.label.trim().slice(0, 80)
    : (evil ? "Mission Map (Don't-do)" : "Mission Map");
  const tooltip = payload && typeof payload.tooltip === "string" && payload.tooltip.trim()
    ? payload.tooltip.trim().slice(0, 120)
    : label;

  if (prefs.evilMode !== evil) {
    prefs.evilMode = evil;
    savePrefs();
  }
  currentEvilMode = evil;
  currentTitle = label;
  currentTooltip = tooltip;
  if (payload && typeof payload === "object") {
    currentTrayStatus = {
      openCount: Number(payload.openCount) || 0,
      doneCount: Number(payload.doneCount) || 0,
      totalCount: Number(payload.totalCount) || 0,
      expiredCount: Number(payload.expiredCount) || 0,
      pomoState: typeof payload.pomoState === "string" ? payload.pomoState : ""
    };
  }

  let img = null;
  if (payload && typeof payload.dataUrl === "string" && payload.dataUrl.startsWith("data:image/")) {
    const parsed = nativeImage.createFromDataURL(payload.dataUrl);
    if (!parsed.isEmpty()) img = parsed;
  }
  if (!img || img.isEmpty()) {
    img = loadDefaultIcon(evil);
  }

  let traySrcImg = null;
  if (payload && typeof payload.trayDataUrl === "string" && payload.trayDataUrl.startsWith("data:image/")) {
    const parsedTray = nativeImage.createFromDataURL(payload.trayDataUrl);
    if (!parsedTray.isEmpty()) traySrcImg = parsedTray;
  }
  if (!traySrcImg || traySrcImg.isEmpty()) {
    traySrcImg = img;
  }

  if (img && !img.isEmpty()) {
    currentIconImage = img;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setIcon(img);
    }
  }
  if (tray && !tray.isDestroyed() && traySrcImg && !traySrcImg.isEmpty()) {
    const traySize = traySrcImg.getSize();
    const trayImg = (traySize.width === 32 && traySize.height === 32)
      ? traySrcImg
      : traySrcImg.resize({ width: 32, height: 32, quality: "best" });
    tray.setImage(trayImg);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(currentTitle);
  }
  if (tray && !tray.isDestroyed()) {
    tray.setToolTip(currentTooltip);
  }
  rebuildTrayMenu();
}

function createWindow() {
  currentIconImage = loadDefaultIcon(!!prefs.evilMode);

  const initialBounds = prefs.miniMode
    ? clampBoundsToWorkArea(prefs.miniBounds || { width: MINI_WIDTH, height: MINI_HEIGHT })
    : clampBoundsToWorkArea(prefs.bounds);

  mainWindow = new BrowserWindow({
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: prefs.miniMode ? 320 : 360,
    minHeight: prefs.miniMode ? 380 : 420,
    title: currentTitle,
    icon: currentIconImage && !currentIconImage.isEmpty() ? currentIconImage : undefined,
    backgroundColor: "#d6d7c0",
    autoHideMenuBar: true,
    alwaysOnTop: !!(prefs.miniMode || prefs.alwaysOnTop),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (!prefs.miniMode && prefs.maximized) {
    mainWindow.maximize();
  }

  mainWindow.removeMenu();
  mainWindow.loadURL(serverUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedOAuthPopupUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 500,
          height: 660,
          autoHideMenuBar: true,
          parent: mainWindow,
          icon: currentIconImage && !currentIconImage.isEmpty() ? currentIconImage : undefined,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-create-window", (childWin) => {
    childWin.removeMenu();
    childWin.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedOAuthPopupUrl(url)) return { action: "allow" };
      if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    broadcastState();
  });

  const persistWindowGeometry = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (prefs.miniMode) {
      prefs.miniBounds = mainWindow.getBounds();
    } else if (!mainWindow.isMaximized()) {
      prefs.bounds = mainWindow.getBounds();
      prefs.maximized = false;
    } else {
      prefs.maximized = true;
    }
    savePrefs();
  };

  mainWindow.on("resize", persistWindowGeometry);
  mainWindow.on("move", persistWindowGeometry);
  mainWindow.on("maximize", persistWindowGeometry);
  mainWindow.on("unmaximize", persistWindowGeometry);
  mainWindow.on("show", rebuildTrayMenu);
  mainWindow.on("hide", rebuildTrayMenu);

  mainWindow.on("close", (ev) => {
    persistWindowGeometry();
    if (!isQuitting && prefs.minimizeToTray) {
      ev.preventDefault();
      mainWindow.hide();
      rebuildTrayMenu();
      if (!trayHintShown && Notification.isSupported()) {
        trayHintShown = true;
        const n = new Notification({
          title: "Mission Map is still running",
          body: "Minimized to system tray. Use Ctrl+Shift+A to add a mission or right-click the tray icon to quit.",
          icon: currentIconImage && !currentIconImage.isEmpty() ? currentIconImage : undefined
        });
        n.on("click", showWindow);
        n.show();
      }
    }
  });
}

function createTray() {
  const baseIcon = currentIconImage && !currentIconImage.isEmpty() ? currentIconImage : loadDefaultIcon(!!prefs.evilMode);
  const trayIcon = baseIcon.isEmpty() ? baseIcon : baseIcon.resize({ width: 32, height: 32, quality: "best" });
  tray = new Tray(trayIcon);
  tray.setToolTip(currentTooltip || currentTitle);
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else showWindow();
    rebuildTrayMenu();
  });
  tray.on("double-click", showWindow);
  rebuildTrayMenu();
}

function registerShortcuts() {
  try {
    globalShortcut.register("CommandOrControl+Shift+A", () => {
      showWindow();
      sendRendererCommand("add-mission");
    });
    globalShortcut.register("CommandOrControl+Shift+M", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible()) showWindow();
      applyMiniMode(!prefs.miniMode);
    });
    globalShortcut.register("CommandOrControl+Shift+P", () => {
      sendRendererCommand("toggle-pomo");
    });
  } catch (_err) {}
}

function wireIpc() {
  ipcMain.handle("desktop:getState", () => getDesktopState());

  ipcMain.handle("desktop:setMiniMode", (_ev, enabled) => applyMiniMode(!!enabled));
  ipcMain.handle("desktop:toggleMiniMode", () => applyMiniMode(!prefs.miniMode));
  ipcMain.handle("desktop:setAlwaysOnTop", (_ev, enabled) => setAlwaysOnTop(!!enabled));
  ipcMain.handle("desktop:setMinimizeToTray", (_ev, enabled) => setMinimizeToTray(!!enabled));

  ipcMain.handle("desktop:setAppIcon", (_ev, payload) => {
    updateAppIcons(payload || {});
    return { ok: true };
  });

  ipcMain.handle("desktop:notify", (_ev, payload) => {
    if (!Notification.isSupported()) return { ok: false, unsupported: true };
    const title = payload && typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim().slice(0, 120)
      : "Mission Map";
    const body = payload && typeof payload.body === "string"
      ? payload.body.trim().slice(0, 300)
      : "";
    const n = new Notification({
      title,
      body,
      icon: currentIconImage && !currentIconImage.isEmpty() ? currentIconImage : undefined
    });
    n.on("click", () => {
      showWindow();
      if (payload && typeof payload.action === "string" && payload.action) {
        sendRendererCommand(payload.action);
      }
    });
    n.show();
    return { ok: true };
  });

  ipcMain.handle("desktop:savePng", async (_ev, payload) => {
    const rawName = payload && typeof payload.filename === "string" ? path.basename(payload.filename) : "mission-map.png";
    const safeName = (rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "mission-map.png").replace(/(?:\.png)?$/i, ".png");
    const dataUrl = payload && typeof payload.dataUrl === "string" ? payload.dataUrl : "";
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return { ok: false, error: "Invalid PNG image payload" };
    }
    const defaultDir = app.getPath("pictures") || app.getPath("desktop") || app.getPath("downloads");
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Save Mission Map PNG",
      defaultPath: path.join(defaultDir, safeName),
      filters: [{ name: "PNG Image", extensions: ["png"] }]
    });
    if (canceled || !filePath) {
      return { ok: false, canceled: true };
    }
    fs.writeFileSync(filePath, Buffer.from(match[1], "base64"));
    return { ok: true, path: filePath };
  });
}

app.on("second-instance", () => {
  showWindow();
});

app.whenReady().then(async () => {
  loadPrefs();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL() || "";
    const isOwnOrigin = serverUrl && url.startsWith(serverUrl);
    if (isOwnOrigin && (permission === "media" || permission === "notifications" || permission === "geolocation")) {
      callback(true);
      return;
    }
    callback(false);
  });

  serverUrl = await startAssetServer();
  wireIpc();
  createWindow();
  createTray();
  registerShortcuts();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  try { globalShortcut.unregisterAll(); } catch (_err) {}
  if (assetServer) {
    try { assetServer.close(); } catch (_err) {}
  }
});

app.on("window-all-closed", () => {
  if (!prefs.minimizeToTray || isQuitting) {
    app.quit();
  }
});
