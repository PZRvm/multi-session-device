import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DialogOptions, DialogResult } from '@shared/types'

export const dialogApi = {
  show: (options: DialogOptions): Promise<DialogResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.dialogShow, options)
}
