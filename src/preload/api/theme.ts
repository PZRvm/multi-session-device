import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ThemeSystemId } from '@shared/themeSystems'
import type { ThemeInitialState, ThemeMode, ThemeSelection } from '@shared/types'

export const themeApi = {
  /** boot 初值：preload 加载时同步取一次（主进程内存应答，无磁盘 IO），renderer 首帧零闪的取值点 */
  initial: ipcRenderer.sendSync(IPC_CHANNELS.themeGetSync) as ThemeInitialState,
  setMode: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.themeSetMode, mode),
  setSystemId: (systemId: ThemeSystemId): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.themeSetSystemId, systemId),
  /** 主题变更推送订阅（跨窗跟随），返回解绑函数 */
  onChanged: (callback: (selection: ThemeSelection) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, selection: ThemeSelection): void => {
      callback(selection)
    }
    ipcRenderer.on(IPC_CHANNELS.themeChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.themeChanged, listener)
    }
  }
}
