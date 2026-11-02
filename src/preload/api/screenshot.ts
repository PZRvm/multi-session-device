import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenshotCaptureResult, ScreenshotSaveResult } from '@shared/types'
import type { CaptureEditApplyPayload, CaptureEditImagePayload } from '@shared/screenshot-editor'

/** 截屏域白名单桥：capture/save 仅主窗；编辑四方法中 openEditor 仅主窗，
 *  getEditImage/editCopy/editDownload 仅已登记编辑窗（main 侧 sender 判定） */
export const screenshotApi = {
  capture: (id: string): Promise<ScreenshotCaptureResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotCapture, { id }),
  save: (id: string): Promise<ScreenshotSaveResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotSave, { id }),
  openEditor: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotOpenEditor, { id }),
  getEditImage: (): Promise<CaptureEditImagePayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotGetEditImage),
  editCopy: (payload: CaptureEditApplyPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotEditCopy, payload),
  editDownload: (payload: CaptureEditApplyPayload): Promise<ScreenshotSaveResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotEditDownload, payload)
}
