import { app, BrowserWindow, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers, shutdownStreams } from './ipc'
import { prepareAppShutdown, resumeAfterShutdown } from './devices'
import { restoreTheme } from './theme'
import { restoreLocale } from './locale'
import { appIcon } from './app-icon'
import { msg } from './locale'

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })

  // 主题与语言恢复先于建窗：nativeTheme.themeSource 与建窗 backgroundColor 依赖主题读盘；
  // 主进程可见文案依赖语言内存态（两者 load 均不抛错，失败按缺省起步——详见各 store）
  void Promise.all([restoreTheme(), restoreLocale()]).then(() => createMainWindow())
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
    await shutdownStreams()
    if (leftovers.length === 0) {
      quitGuard = true
      app.quit()
      return
    }
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: msg('quitCleanupTitle'),
      message: msg('quitCleanupMessage', { count: leftovers.length }),
      detail: msg('quitCleanupDetail'),
      buttons: [msg('quitStayButton'), msg('quitForceButton')],
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
