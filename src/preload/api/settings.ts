import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export const settingsApi = {
  open: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.settingsOpen)
}
