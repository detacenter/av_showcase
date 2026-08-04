const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const configPath = path.join(os.homedir(), ".config", "audiovault.json");

let apiBase = "http://localhost:8000";
try {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (cfg.api_base) apiBase = cfg.api_base;
} catch {}

contextBridge.exposeInMainWorld("electronConfig", { apiBase });

contextBridge.exposeInMainWorld("electronEvents", {
  onCycleTab: (cb) => {
    ipcRenderer.removeAllListeners("cycle-tab");
    ipcRenderer.on("cycle-tab", (_, dir) => cb(dir));
  },
});

contextBridge.exposeInMainWorld("electronAuth", {
  reauth: (authorizeUrl) => ipcRenderer.invoke("spotify-reauth-flow", authorizeUrl),
});
