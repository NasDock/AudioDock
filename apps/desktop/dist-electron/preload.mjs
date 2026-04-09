"use strict";
const electron = require("electron");
const listenerMap = /* @__PURE__ */ new WeakMap();
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    const wrappedListener = (event, ...args2) => listener(event, ...args2);
    listenerMap.set(listener, wrappedListener);
    return electron.ipcRenderer.on(channel, wrappedListener);
  },
  off(...args) {
    const [channel, listener] = args;
    const wrappedListener = listenerMap.get(listener);
    if (wrappedListener) {
      listenerMap.delete(listener);
      return electron.ipcRenderer.off(channel, wrappedListener);
    }
    return electron.ipcRenderer.off(channel, listener);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  },
  // You can expose other APTs you need here.
  platform: process.platform,
  getName: async () => {
    return await electron.ipcRenderer.invoke("get-device-name");
  },
  openExternal: (url) => electron.ipcRenderer.invoke("open-url", url),
  selectDirectory: () => electron.ipcRenderer.invoke("select-directory")
});
