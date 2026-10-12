import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DialogOptions, DialogResult } from '@shared/types'

export const dialogApi = {
  show: (options: DialogOptions): Promise<DialogResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.dialogShow, options),
  /** 在 Finder 中显示孤立组文件（路径白名单校验在 main） */
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellShowItemInFolder, { path })
}
