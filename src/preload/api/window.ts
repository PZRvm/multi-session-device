import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export const windowApi = {
  minimize: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
  toggleFullscreen: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.windowToggleFullscreen),
  /** 主进程 focus/blur 推送（自绘三灯切色用），返回解绑函数 */
  onFocusChanged: (callback: (focused: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, focused: boolean): void => {
      callback(focused)
    }
    ipcRenderer.on(IPC_CHANNELS.windowFocusChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.windowFocusChanged, listener)
    }
  }
}
