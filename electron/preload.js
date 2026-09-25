/**
 * Electron preload — 暴露最小安全 API
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,
})
