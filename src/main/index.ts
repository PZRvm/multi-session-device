import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { appIcon } from './app-icon'
import { createPocWindow, registerPocIpc } from './poc'

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()

  // PoC dev harness（stage 04 步骤 1）：MSD_POC=1 时开 PoC 页而非主窗
  if (process.env['MSD_POC'] === '1') {
    registerPocIpc()
    createPocWindow()
  } else {
    createMainWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (process.env['MSD_POC'] === '1') createPocWindow()
      else createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
