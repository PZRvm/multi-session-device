import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkProgress, SdkSnapshot } from '@shared/types'

/** SDK 域白名单：状态探测 + bootstrap（进度经 onProgress 推送） */
export const sdkApi = {
  status: (root?: string): Promise<SdkSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkStatus, root),
  bootstrap: (root?: string): Promise<SdkSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkBootstrap, root),
  onProgress: (callback: (progress: SdkProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkProgress, listener)
    }
  }
}
