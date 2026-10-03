import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkProgress, SdkSnapshot } from '@shared/types'
import { appIcon } from '../app-icon'
import { bootstrapSdk, detectSdk } from './sdk'

/** 应用自有 SDK 根（PRD E：userData/AndroidSDK；设置自定义路径属 stage 05） */
export const defaultSdkRoot = (): string => join(app.getPath('userData'), 'AndroidSDK')

const resolveRoot = (raw: unknown): string => {
  if (raw === undefined || raw === null) return defaultSdkRoot()
  if (typeof raw === 'string' && raw.length > 0) return raw
  throw new Error('sdk: 非法的 SDK 根')
}

const pushProgress = (progress: SdkProgress): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.sdkProgress, progress)
  }
}

/** 许可确认——PRD 4.5：必须应用内确认，不静默接受 */
const confirmLicenses = async (): Promise<void> => {
  const window = BrowserWindow.getAllWindows()[0]
  const options = {
    title: 'Android SDK 许可确认',
    message: '首次引导需要下载 Android SDK 组件（platform-tools、emulator 等）。',
    detail:
      '这些组件受 Android SDK 许可协议约束：\n· android-sdk-license（两版）\n· android-sdk-preview-license\n\n同意后本应用将在自有目录内写入许可确认文件并下载组件（数百 MB，仅此一次）。你拒绝则不下载、不写任何文件。',
    buttons: ['同意并继续', '拒绝'],
    cancelId: 1,
    icon: appIcon
  }
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 0) throw new Error('用户拒绝 Android SDK 许可，bootstrap 中止')
}

export function registerSdkIpc(): void {
  ipcMain.handle(IPC_CHANNELS.sdkStatus, (_event, raw: unknown): Promise<SdkSnapshot> =>
    detectSdk(resolveRoot(raw))
  )

  ipcMain.handle(IPC_CHANNELS.sdkBootstrap, async (_event, raw: unknown): Promise<SdkSnapshot> => {
    const root = resolveRoot(raw)
    const snapshot = await detectSdk(root)
    if (!snapshot.licensed) await confirmLicenses()
    return bootstrapSdk(root, {}, pushProgress)
  })
}
