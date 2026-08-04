const { app, BrowserWindow, shell, nativeImage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const iconPath = path.join(__dirname, "assets/icon.png");
const appIcon = nativeImage.createFromPath(iconPath);

const isDev = !app.isPackaged;

app.setName("Audiovault");

// --- Window bounds persistence ---
const boundsFile = path.join(app.getPath("userData"), "window-bounds.json");

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile, "utf8"));
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveBounds(win) {
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(win.getBounds()), "utf8");
  } catch {}
}

// --- Main window ---
function createWindow() {
  const bounds = loadBounds();

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: "Audiovault",
    titleBarStyle: "hiddenInset",
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    const port = process.env.VITE_PORT || "5173";
    win.loadURL("http://127.0.0.1:" + port);
    if (process.env.DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
  } else {
    console.log("[main] loading dist/index.html");
    win.loadFile(path.join(__dirname, "../frontend/dist/index.html"));
  }

  // Visualizer popout → native Electron child window.
  // Everything else external → system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes("popout=1")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 760,
          height: 430,
          minWidth: 400,
          minHeight: 260,
          title: "Audiovault Visualizer",
          titleBarStyle: "hiddenInset",
          icon: appIcon,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Intercept Cmd+[ and Cmd+] — event.preventDefault() stops Electron's back/forward
  // but also swallows the keydown from the renderer, so we forward via IPC instead.
  win.webContents.on("before-input-event", (event, input) => {
    if ((input.meta || input.control) && (input.key === "[" || input.key === "]")) {
      event.preventDefault();
      win.webContents.send("cycle-tab", input.key === "]" ? 1 : -1);
    }
  });

  win.on("close", () => saveBounds(win));
}

// --- Spotify reauth popup ---
// The backend's redirect_uri (http://127.0.0.1:3000/callback) has nothing listening
// on it once Electron owns the flow — we intercept the navigation attempt itself
// before it ever hits the network, so the popup never actually needs to load it.
ipcMain.handle("spotify-reauth-flow", (_event, authorizeUrl) => {
  return new Promise((resolve, reject) => {
    let settled = false;

    const popup = new BrowserWindow({
      width: 500,
      height: 700,
      title: "Connect Spotify",
      titleBarStyle: "hiddenInset",
      icon: appIcon,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const handleRedirect = (event, url) => {
      if (!url.startsWith("http://127.0.0.1:3000/callback")) return;
      event.preventDefault();
      if (settled) return;
      settled = true;
      const parsed = new URL(url);
      const code = parsed.searchParams.get("code");
      const error = parsed.searchParams.get("error");
      popup.close();
      if (code) resolve({ code });
      else reject(new Error(error || "Spotify authorization failed"));
    };

    popup.webContents.on("will-redirect", handleRedirect);
    popup.webContents.on("will-navigate", handleRedirect);

    popup.on("closed", () => {
      if (!settled) {
        settled = true;
        reject(new Error("cancelled"));
      }
    });

    popup.loadURL(authorizeUrl);
  });
});

app.commandLine.appendSwitch("disable-features", "PrivateNetworkAccessChecks");

app.whenReady().then(() => {
  if (app.dock) app.dock.setIcon(appIcon);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
