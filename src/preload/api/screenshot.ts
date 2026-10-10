import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenshotCaptureResult, ScreenshotSaveResult } from '@shared/types'

/** 截屏域白名单桥（仅登记主窗）：capture 截屏并受控写系统剪贴板；save 用主进程缓存写下载目录 */
export const screenshotApi = {
  capture: (id: string): Promise<ScreenshotCaptureResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotCapture, { id }),
  save: (id: string): Promise<ScreenshotSaveResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotSave, { id })
}
