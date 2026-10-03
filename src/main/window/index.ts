import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import icon from '../../../resources/icon.png?asset'

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // darwin 去原生标题条（hiddenInset 保留标准阴影/圆角），三灯由 renderer 自绘
    // （BoardHead 圆点钮）——原生灯在 hidden 系样式下失焦会整组消失/置灰到不可见
    // （2026-10-04 两轮用户报障，learn 2026-10-04-titlebar-hidden-blur-traffic-lights），
    // 故建窗后永久隐藏原生灯，聚焦/失焦全靠自绘；trafficLightPosition 随之废弃。
    // 窗口最小化/全屏经 window:minimize / window:toggle-fullscreen（controls.ts）
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  if (process.platform === 'darwin') {
    // 自绘三灯的先决条件：原生灯永久退场（悬浮于内容上方，不藏会叠画）
    mainWindow.setWindowButtonVisibility(false)
    // focus/blur 推送——renderer 圆点切色（聚焦 mac 三色 / 失焦置灰）
    const pushFocus = (focused: boolean): void => {
      mainWindow.webContents.send(IPC_CHANNELS.windowFocusChanged, focused)
    }
    mainWindow.on('focus', () => pushFocus(true))
    mainWindow.on('blur', () => pushFocus(false))
  }

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
