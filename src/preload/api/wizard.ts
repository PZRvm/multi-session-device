import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export const wizardApi = {
  /** 主窗调：打开/聚焦新建设备模态窗（main 侧单例裁决） */
  open: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.wizardOpen),
  /** 向导窗自己调：请求主进程关闭本窗 */
  close: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.wizardClose)
}
