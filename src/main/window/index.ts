import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // 标准原生标题条（2026-10-04 四轮终裁：hidden 系三灯失焦表现反复不能达标，
    // 完整原生标题条零风险——三灯恒在、失焦置灰、悬停出 ×/−/+ glyph、拖拽区系统
    // 自带；向导窗同款形态从未有异议）。窗口标题与 index.html <title> 同名双保险，
    // page-title-updated 拦截防渲染层覆写
    title: '多会话设备',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('page-title-updated', (event) => event.preventDefault())

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
