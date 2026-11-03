import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DialogOptions, DialogResult } from '@shared/types'

export const dialogApi = {
  show: (options: DialogOptions): Promise<DialogResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.dialogShow, options),
  /** 在 Finder 中显示孤立组文件（路径白名单校验在 main） */
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellShowItemInFolder, { path }),
  /** 打开「启用或关闭 Windows 功能」（WHPX 缺失引导；固定 URI，仅 win32，校验在 main） */
  openWindowsFeatures: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellOpenWindowsFeatures),
  /** 打开 Windows 安全中心（杀软白名单建议；固定 URI，仅 win32，校验在 main） */
  openWindowsDefender: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.shellOpenWindowsDefender)
}
