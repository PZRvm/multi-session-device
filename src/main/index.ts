import { app, BrowserWindow, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { registerIpcHandlers, shutdownStreams } from './ipc'
import {
  prepareAppShutdown,
  resumeAfterShutdown,
  resumeExternalSessions,
  stopExternalTracking
} from './devices'
import { restoreTheme } from './theme'
import { restoreLocale } from './locale'
import { restoreSdkSource } from './emulator/sdkSource'
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

  // 主题/语言/SDK 来源恢复先于建窗：nativeTheme.themeSource 与建窗 backgroundColor 依赖
  // 主题读盘；主进程可见文案依赖语言内存态；SDK 活动根在建窗前就绪（IPC 根解析不落到缺省）。
  // 三者 load 均不抛错，失败按缺省起步——详见各 store
  void Promise.all([restoreTheme(), restoreLocale(), restoreSdkSource()]).then(() =>
    createMainWindow()
  )
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
      // 真机 track 收口只在确认退出分支执行（review P2-1：留在取消路径会永久停跟踪）
      stopExternalTracking()
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
      // 用户留下：外部会话随 shutdownStreams 的 destroyAll 一并销毁——重发 connected
      // （代次自增）恢复真机投屏/网络/日志；track 连接全程未断
      resumeExternalSessions()
      return
    }
    quitGuard = true
    stopExternalTracking()
    app.exit(0)
  })()
})
