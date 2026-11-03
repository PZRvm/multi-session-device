/* eslint-disable @typescript-eslint/no-require-imports -- Electron 沙箱 preload / 启动引导要求 CommonJS */
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('poc', {
  report: (value) => ipcRenderer.invoke('poc:report', value)
})
