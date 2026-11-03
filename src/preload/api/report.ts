import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'

/** 对账详情窗白名单：仅主窗可发起开窗（sender 守卫在 main） */
export const reportApi = {
  openWindow: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.reportWindowOpen)
}
