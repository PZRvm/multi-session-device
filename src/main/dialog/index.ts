import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DialogOptions, DialogResult } from '@shared/types'
import { appIcon } from '../app-icon'
import { msg } from '../locale'
import { app } from 'electron'
import { resolve as resolvePath } from 'node:path'

/** 原生 MessageBox 没有滚动条：detail 行数直接撑高度，超长时按钮被挤出屏幕且
 *  无法点击（用户实测对账明细弹窗，2026-10-12）。统一防线：超过预算行数截断
 *  并附省略说明——所有 dialog:show 调用点（对账/卸载/迁移确认等）一并生效。 */
const MAX_DETAIL_LINES = 40

const clampDetail = (detail: string): string => {
  const lines = detail.split('\n')
  if (lines.length <= MAX_DETAIL_LINES) return detail
  const omitted = lines.length - MAX_DETAIL_LINES
  return (
    lines.slice(0, MAX_DETAIL_LINES).join('\n') + '\n' + msg('dialogDetailTruncated', { omitted })
  )
}

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
  // 孤立组处置入口：在 Finder 中显示（用户自行删改——保留「不自动清理」语义）。
  // 路径白名单：只放行应用 avdHome 下的文件，拒绝任意路径探测。
  ipcMain.handle(IPC_CHANNELS.shellShowItemInFolder, (_event, raw: unknown): void => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).path !== 'string'
    ) {
      throw new Error(`${IPC_CHANNELS.shellShowItemInFolder}: ${msg('invalidDialogOptions')}`)
    }
    const target = (raw as Record<string, unknown>).path as string
    if (target.includes('\0')) {
      throw new Error(`${IPC_CHANNELS.shellShowItemInFolder}: ${msg('shellPathRejected')}`)
    }
    // 白名单按归一化绝对路径比对（issue review P1：未归一化前缀比对可被 `..` 穿越）
    // avdHome 单源表达式（本地复算：dialog 测试环境拉不动 emulator/index 依赖链）
    const base = resolvePath(app.getPath('userData'), 'avd-home')
    const resolved = resolvePath(target)
    if (process.env.DLG_DBG) {
      console.log('[dbg]', JSON.stringify({ target, base, resolved, cwd: process.cwd() }))
    }
    if (resolved !== base && !resolved.startsWith(base + '/')) {
      throw new Error(`${IPC_CHANNELS.shellShowItemInFolder}: ${msg('shellPathRejected')}`)
    }
    void shell.showItemInFolder(resolved)
  })

  ipcMain.handle(IPC_CHANNELS.dialogShow, async (event, raw: unknown): Promise<DialogResult> => {
    // renderer 传来的 payload 不可信，先过运行时守卫再进业务
    if (!isDialogOptions(raw)) {
      throw new Error(`${IPC_CHANNELS.dialogShow}: ${msg('invalidDialogOptions')}`)
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      ...raw,
      detail: raw.detail === undefined ? undefined : clampDetail(raw.detail),
      icon: appIcon
    }
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    return { response: result.response, checkboxChecked: result.checkboxChecked }
  })
}
