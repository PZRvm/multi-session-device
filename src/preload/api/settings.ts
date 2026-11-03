import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { AboutInfo } from '@shared/types'

export const settingsApi = {
  open: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.settingsOpen),
  /** 关于页数据面：版本与数据目录真值 + 受控打开目录（sender 守卫在 main） */
  about: {
    get: (): Promise<AboutInfo> => ipcRenderer.invoke(IPC_CHANNELS.aboutGet),
    openDataDirectory: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.aboutOpenDataDirectory)
  }
}
