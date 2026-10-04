import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  ScreenAckMessage,
  ScreenInputRequest,
  ScreenPacketMessage,
  ScreenStateMessage
} from '@shared/types'

/** 投屏域白名单（仅登记主窗；监听全部返回解绑函数） */
export const screenApi = {
  /** 登记活动视图（id=null 退订）；listener 先安装，早到包按预设 viewToken 识别 */
  activate: (id: string | null, viewToken: string): Promise<ScreenStateMessage | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenActivate, { id, viewToken }),
  /** 仅重建本设备失败的流（emulator 不重启） */
  retry: (id: string, runId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenRetry, { id, runId }),
  /** 包已消费回执（流控） */
  ack: (ack: ScreenAckMessage): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.screenAck, ack),
  /** 触控/按键/文本/旋转闭集 */
  input: (request: ScreenInputRequest): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenInput, request),
  onState: (callback: (message: ScreenStateMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: ScreenStateMessage): void => {
      callback(message)
    }
    ipcRenderer.on(IPC_CHANNELS.screenState, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.screenState, listener)
    }
  },
  onPacket: (callback: (message: ScreenPacketMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: ScreenPacketMessage): void => {
      callback(message)
    }
    ipcRenderer.on(IPC_CHANNELS.screenPacket, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.screenPacket, listener)
    }
  }
}
