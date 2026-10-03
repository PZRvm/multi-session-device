import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'

/** 自绘三灯的窗口控制：renderer 圆点钮的落点（关闭走 renderer 的 window.close()） */
export function registerWindowControlsIpc(): void {
  const requireSenderWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('无法定位调用窗口')
    return window
  }

  ipcMain.handle(IPC_CHANNELS.windowMinimize, (event): void => {
    requireSenderWindow(event).minimize()
  })

  ipcMain.handle(IPC_CHANNELS.windowToggleFullscreen, (event): void => {
    const window = requireSenderWindow(event)
    window.setFullScreen(!window.isFullScreen())
  })
}
