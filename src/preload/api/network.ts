import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { NetworkChangedMessage, NetworkSetResult, NetworkTarget } from '@shared/types'

/** 网络开关域白名单桥（仅登记主窗）：set 下发并读回（以读回为准）；onChanged 订阅变化推送 */
export const networkApi = {
  set: (id: string, target: NetworkTarget, enabled: boolean): Promise<NetworkSetResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.networkSet, { id, target, enabled }),
  /** 网络态变化订阅（1s 轮询 + 下发读回，值变化才推）；返回解绑函数 */
  onChanged: (callback: (message: NetworkChangedMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: NetworkChangedMessage): void => {
      callback(message)
    }
    ipcRenderer.on(IPC_CHANNELS.networkChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.networkChanged, listener)
    }
  }
}
