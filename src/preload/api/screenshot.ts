import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenshotCaptureResult, ScreenshotSaveResult } from '@shared/types'
import type { CaptureEditApplyPayload, CaptureEditImagePayload } from '@shared/screenshot-editor'

/** 截屏域白名单桥：capture/save/openEditor 仅主窗；取图和产出仅已登记编辑窗。
 *  工具栏高度只由对应编辑窗的 webContents 接收。 */
export const screenshotApi = {
  capture: (id: string): Promise<ScreenshotCaptureResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotCapture, { id }),
  save: (id: string): Promise<ScreenshotSaveResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotSave, { id }),
  openEditor: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotOpenEditor, { id }),
  setEditorToolbarHeight: (height: number): void =>
    ipcRenderer.send(IPC_CHANNELS.screenshotEditorToolbarHeight, height),
  getEditImage: (): Promise<CaptureEditImagePayload> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotGetEditImage),
  editCopy: (payload: CaptureEditApplyPayload): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotEditCopy, payload),
  editDownload: (payload: CaptureEditApplyPayload): Promise<ScreenshotSaveResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.screenshotEditDownload, payload)
}
