import { app, BrowserWindow, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc'
import { prepareAppShutdown, resumeAfterShutdown } from './devices'
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
  // macOS：只关窗不退出——模拟器实例继续运行（PRD 4.3）
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 真正退出前先停掉本工具启动的全部实例（PRD 4.3）；有界清理失败默认留在应用内允许重试
let quitGuard = false
app.on('before-quit', (event) => {
  if (quitGuard) return
  event.preventDefault()
  void (async () => {
    const { leftovers } = await prepareAppShutdown()
    if (leftovers.length === 0) {
      quitGuard = true
      app.quit()
      return
    }
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '退出前清理未完成',
      message: `有 ${leftovers.length} 台模拟器实例未能在限期内停止`,
      detail:
        '可以留在应用重试退出；强制退出会留下仍在运行的模拟器进程（它们占用的端口与 AVD 锁会让下次启动被拦截）。',
      buttons: ['留在应用', '强制退出'],
      cancelId: 0,
      icon: appIcon
    })
    if (result.response === 0) {
      resumeAfterShutdown()
      return
    }
    quitGuard = true
    app.exit(0)
  })()
})
