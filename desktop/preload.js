"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function onChannel(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const handler = (_event, payload) => {
    try { callback(payload); } catch (_err) {}
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("desktopAPI", {
  isDesktop: true,
  platform: process.platform,
  getState: () => ipcRenderer.invoke("desktop:getState"),
  setMiniMode: (enabled) => ipcRenderer.invoke("desktop:setMiniMode", !!enabled),
  toggleMiniMode: () => ipcRenderer.invoke("desktop:toggleMiniMode"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("desktop:setAlwaysOnTop", !!enabled),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke("desktop:setMinimizeToTray", !!enabled),
  minimize: () => ipcRenderer.invoke("desktop:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("desktop:toggleMaximize"),
  toggleFullscreen: () => ipcRenderer.invoke("desktop:toggleFullscreen"),
  closeWindow: () => ipcRenderer.invoke("desktop:closeWindow"),
  getActiveMedia: () => ipcRenderer.invoke("desktop:getActiveMedia"),
  setAppIcon: (payload) => ipcRenderer.invoke("desktop:setAppIcon", payload && typeof payload === "object" ? payload : {}),
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload && typeof payload === "object" ? payload : {}),
  savePng: (payload) => ipcRenderer.invoke("desktop:savePng", payload && typeof payload === "object" ? payload : {}),
  onCommand: (cb) => onChannel("desktop:command", cb),
  onState: (cb) => onChannel("desktop:state", cb)
});
