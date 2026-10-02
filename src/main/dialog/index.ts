import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DialogOptions, DialogResult } from '@shared/types'

const isDialogOptions = (value: unknown): value is DialogOptions => {
  if (typeof value !== 'object' || value === null) return false
  const { title, message, detail, buttons, cancelId } = value as Record<string, unknown>
  if (typeof title !== 'string' || typeof message !== 'string') return false
  if (detail !== undefined && typeof detail !== 'string') return false
  if (
    !Array.isArray(buttons) ||
    buttons.length === 0 ||
    buttons.length > 3 ||
    !buttons.every((button) => typeof button === 'string')
  ) {
    return false
  }
  if (
    cancelId !== undefined &&
    (typeof cancelId !== 'number' || cancelId < 0 || cancelId >= buttons.length)
  ) {
    return false
  }
  return true
}

export function registerDialogIpc(): void {
  ipcMain.handle(IPC_CHANNELS.dialogShow, async (event, raw: unknown): Promise<DialogResult> => {
    // renderer 传来的 payload 不可信，先过运行时守卫再进业务
    if (!isDialogOptions(raw)) {
      throw new Error(`${IPC_CHANNELS.dialogShow}: 非法的 options`)
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showMessageBox(window, raw)
      : await dialog.showMessageBox(raw)
    return { response: result.response, checkboxChecked: result.checkboxChecked }
  })
}
