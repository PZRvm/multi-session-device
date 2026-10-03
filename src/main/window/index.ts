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
    // darwin 去原生标题条，三灯浮于 renderer 板头行左端（BoardHead 40px，灯高 16，
    // y=(40-16)/2=12，x 与板头内边距对齐——契约同姊妹仓库 main/index.ts，板头高度
    // 变更须连校本值）；其余平台保持系统框。
    // 用 hiddenInset 而非 hidden：hidden 的怪癖是失焦时系统整组隐藏三灯
    // （2026-10-04 用户报障，setWindowButtonVisibility(true) 于 blur 时点抢不过
    // 系统行为，实测无效）；hiddenInset 三灯失焦只置灰不消失
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
