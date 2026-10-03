import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ThemeMode } from '@shared/types'

export const themeApi = {
  setMode: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.themeSetMode, mode)
}
