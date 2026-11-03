import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { appIcon } from '../app-icon'
import { registerWindowTitleBar, themeWindowBackground, themeWindowTitleBarOverlay } from '../theme'
import { closeWizardWindow } from './wizard'
import { closeSettingsWindow } from './settings'
import { closeLogcatWindow } from './logcat'
import { closeReportWindow } from './report'
import { closeWirelessWindow } from './wireless'
import { closeAllScreenshotEditorWindows } from './screenshotEditor'
import { msg } from '../locale'

// 主窗登记（devices 域 sender 白名单的判定源）：引用随窗口销毁清空
let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    // dock 默认收起，默认窗宽沿用紧凑值；展开/贴回日志 dock 时由 dock-state
    // 通路按需拉宽并锁 minWidth（列表 280 + 分隔条 + 日志栏 320 + 画布保底 560）
    width: 900,
    height: 670,
    show: false,
    // 建窗底色即主题板面底（boot 已恢复主题），深色用户首帧不闪白
    backgroundColor: themeWindowBackground(),
    autoHideMenuBar: true,
    // macOS 原生三灯嵌入 40px 板头，hiddenInset 保留原生按钮及失焦行为。
    // 标题用于任务切换器；page-title-updated 防止页面覆写。
    title: msg('windowTitle'),
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : process.platform === 'win32'
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: themeWindowTitleBarOverlay() }
        : {}),
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  if (process.platform === 'win32') registerWindowTitleBar(window)
  window.on('page-title-updated', (event) => event.preventDefault())

  window.on('closed', () => {
    mainWindow = null
    // 向导窗与主窗无父子关系（2026-10-06 去 parent）——主窗关闭时显式带走，不留孤儿窗口
    closeWizardWindow()
    closeSettingsWindow()
    closeLogcatWindow()
    closeReportWindow()
    closeWirelessWindow()
    closeAllScreenshotEditorWindows()
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window
  return window
}
