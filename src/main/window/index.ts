import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { closeWizardWindow } from './wizard'
import { closeSettingsWindow } from './settings'
import { msg } from '../locale'

// 主窗登记（devices 域 sender 白名单的判定源）：引用随窗口销毁清空
let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
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
      : {}),
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  window.on('page-title-updated', (event) => event.preventDefault())

  window.on('closed', () => {
    mainWindow = null
    // 向导窗与主窗无父子关系（2026-10-06 去 parent）——主窗关闭时显式带走，不留孤儿窗口
    closeWizardWindow()
    closeSettingsWindow()
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
