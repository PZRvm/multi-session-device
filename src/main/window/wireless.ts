import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { msg } from '../locale'
import { getMainWindow } from './index'

// 无线连接独立窗口单例（plan 2026-10-15-real-device-wireless 追加，2026-10-15 用户
// 裁定：连接器从渲染层弹层改为 mac 原生弹窗——弹层锚定与窗口几何打架且可能被菜单栏
// 遮挡、关不掉；原生窗三灯即关闭）。模式对齐向导窗（2026-10-06 同裁定：非模态、
// 无 parent、主窗关闭显式带走）；重复打开 = 聚焦既有窗。
let wirelessWindow: BrowserWindow | null = null

/** external 域 sender 守卫用：无线连接窗有权调用五个无线通道 */
export function wirelessOwns(sender: Electron.WebContents): boolean {
  const window = BrowserWindow.fromWebContents(sender)
  return window !== null && !window.isDestroyed() && window === wirelessWindow
}

/** 主窗关闭时带走（非模态子窗不随父窗自动销毁） */
export function closeWirelessWindow(): void {
  if (wirelessWindow && !wirelessWindow.isDestroyed()) wirelessWindow.close()
}

export function openWirelessWindow(): void {
  if (wirelessWindow && !wirelessWindow.isDestroyed()) {
    wirelessWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 380,
    height: 560,
    minWidth: 340,
    minHeight: 420,
    show: false,
    backgroundColor: themeWindowBackground(),
    title: msg('wirelessWindowTitle'),
    icon: appIcon,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  wirelessWindow = window
  window.on('closed', () => {
    if (wirelessWindow === window) wirelessWindow = null
  })
  window.once('ready-to-show', () => {
    if (wirelessWindow !== window || window.isDestroyed()) return
    window.show()
    window.focus()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/wireless.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/wireless.html'))
  }
}

/** 打开通道（仅主窗可发起——列表组头按钮与空态入口都在主窗） */
export function registerWirelessIpc(): void {
  ipcMain.handle(IPC_CHANNELS.devicesExternalConnectorOpen, (event): void => {
    if (getMainWindow()?.webContents.id !== event.sender.id) {
      throw new Error(
        `${IPC_CHANNELS.devicesExternalConnectorOpen}: ${msg('unregisteredWindowSuffix')}`
      )
    }
    openWirelessWindow()
  })
}
