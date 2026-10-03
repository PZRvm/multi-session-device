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
    // darwin 去原生标题条，原生三灯浮于 renderer 板头行左端（BoardHead 40px，灯高
    // 16，y=(40-16)/2=12，x 与板头内边距对齐——契约同姊妹仓库 main/index.ts，板头
    // 高度变更须连校本值）。
    // hiddenInset（2026-10-04 三轮用户拍板：要原生灯，失焦灰态可接受）：失焦置灰
    // 是 macOS 标准形态；hidden 才是失焦整组消失的坑。自绘方案（1c86331）经用户
    // 裁决回退——learn 2026-10-04-titlebar-hidden-blur-traffic-lights 记全程
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

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
