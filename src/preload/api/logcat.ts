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
    ipcRenderer.invoke(IPC_CHANNELS.logcatWindowOpen, { deviceId }),
  /** 主窗调：独立日志窗是否开着（dock 入口点击时判定聚焦 vs 开合） */
  isWindowOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.logcatWindowState),
  /** 日志窗调：贴回主窗（关日志窗 + 主窗重新展开 dock） */
  dockBack: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.logcatDockBack),
  /** 主窗调：同步 dock 展开态——展开锁 minWidth（不够宽拉宽），收起解锁 */
  setDockState: (state: { expanded: boolean; minWidth?: number }): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.logcatDockState, state),
  /** 主窗订阅贴回事件（触发 dock 重新展开），返回解绑函数 */
  onDockBack: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.logcatDockBack, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.logcatDockBack, listener)
    }
  }
}
