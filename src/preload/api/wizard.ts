import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { WizardContext } from '@shared/types'

export const wizardApi = {
  /** 主窗调：打开/聚焦新建设备模态窗（main 侧单例裁决） */
  open: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.wizardOpen),
  /** 主窗调：为指定设备打开/聚焦编辑窗（上下文固定；已有其他上下文窗口时报错） */
  openEditor: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.wizardOpenEditor, { id: deviceId }),
  /** 向导窗自己调：读取本窗口固定的 create/edit 上下文（非向导窗会被拒绝） */
  context: (): Promise<WizardContext | null> => ipcRenderer.invoke(IPC_CHANNELS.wizardContext),
  /** 向导窗自己调：请求主进程关闭本窗 */
  close: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.wizardClose)
}
