import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // darwin 去标题条（hiddenInset 保标准圆角/阴影/交通灯图层），三灯自绘于板头
    // 带图形（2026-10-04 五轮终裁：用户要无原生标题条 + 页面内三灯；原生灯经
    // setWindowButtonVisibility 永久退场——learn 条目记全程）。标题仍设：无标题条
    // 时不占版面，cmd-tab/任务切换器显示用；page-title-updated 拦截防渲染层覆写
    title: '多会话设备',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('page-title-updated', (event) => event.preventDefault())

  if (process.platform === 'darwin') {
    // 自绘三灯的先决条件：原生灯永久退场（不藏会与自绘叠画）；focus/blur 推送
    // 给板头圆点切色（聚焦 mac 三色 / 失焦置灰），窗口控制走 controls.ts 的 IPC
    mainWindow.setWindowButtonVisibility(false)
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
