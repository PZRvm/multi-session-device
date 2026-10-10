import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceSnapshot, LogcatAckMessage, LogcatBatchMessage } from '@shared/types'

/** 日志域白名单桥：任意窗口可订阅（与投屏域仅主窗不同）；监听返回解绑函数 */
export const logcatApi = {
  /** 订阅设备日志（回放缓冲尾 + 实时）；设备未 running 时 reject */
  subscribe: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.logcatSubscribe, { deviceId }),
  /** 退订单设备（关窗由 main 侧 destroyed 钩子兜底清理） */
  unsubscribe: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.logcatUnsubscribe, { deviceId }),
  /** 批次回执（流控）：确认到 upToSeq（含） */
  ack: (message: LogcatAckMessage): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.logcatAck, message),
  /** 订阅批次监听 */
  onBatch: (callback: (message: LogcatBatchMessage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: LogcatBatchMessage): void => {
      callback(message)
    }
    ipcRenderer.on(IPC_CHANNELS.logcatBatch, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.logcatBatch, listener)
    }
  },
  /** 日志窗启动上下文：当前设备快照（仅日志窗可调） */
  context: (): Promise<DeviceSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.logcatContext),
  /** 主窗调：开/聚焦独立日志窗（可带目标设备） */
  openWindow: (deviceId?: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.logcatWindowOpen, { deviceId })
}
