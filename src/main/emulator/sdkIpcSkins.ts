import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceSkinSummary, SdkSkinProgress } from '@shared/types'
import { readSkinPresentation } from './skinPresentation'
import { cameraSettingsUrlFor, readCameraSnapshot, requestCameraPermission } from './cameras'
import { importSkinArchive, scanImportedSkins, scanSdkSkins, type SkinRecord } from './skins'
import { downloadSkin, officialSkinName, SKIN_SOURCE_URL } from './skinSource'
import { getMainWindow } from '../window'
import {
  assertSdkWritable,
  cachedSkins,
  pushToAllWindows,
  requireWizardSender,
  resolveRoot,
  setSkinsCache,
  type SdkIpcDeps
} from './sdkIpcShared'
import { resolveSdkRoot } from './sdkSource'
import { msg } from '../locale'

const toSkinSummary = (record: SkinRecord): DeviceSkinSummary => {
  const summarize = (
    orientation: SkinRecord['layout']['portrait']
  ): DeviceSkinSummary['portrait'] =>
    orientation
      ? {
          frameWidth: orientation.frameWidth,
          frameHeight: orientation.frameHeight,
          screenWidth: orientation.screenWidth,
          screenHeight: orientation.screenHeight
        }
      : null
  return {
    id: record.id,
    name: record.name,
    skinRef: record.skinRef,
    source: record.source,
    portrait: summarize(record.layout.portrait),
    landscape: summarize(record.layout.landscape)
  }
}

// 皮肤下载互斥（本分组私有）：同一时刻只允许一个官方皮肤下载
let skinDownloading: string | null = null

/** 机型皮肤域（plan 设计 6/9）：清单只读（主窗+向导）；导入与下载仅向导窗 + 摄像头 */
export function registerSdkSkinsIpc(deps: SdkIpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.sdkDeviceSkinPresentation, async (event, raw: unknown) => {
    if (event.sender !== getMainWindow()?.webContents) throw new Error(msg('skinResourceMainOnly'))
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).deviceId !== 'string'
    )
      throw new Error(msg('invalidDeviceId'))
    if (!deps.savedDeviceSkinRef) throw new Error(msg('skinQueryNotWired'))
    const ref = await deps.savedDeviceSkinRef((raw as { deviceId: string }).deviceId)
    return readSkinPresentation(ref, resolveSdkRoot(), app.getPath('userData'))
  })
  ipcMain.handle(IPC_CHANNELS.sdkCameraAccess, async (event, raw: unknown) => {
    requireWizardSender(IPC_CHANNELS.sdkCameraAccess, event)
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).request !== 'boolean'
    )
      throw new Error(msg('invalidCameraAction'))
    if ((raw as { request: boolean }).request) await requestCameraPermission()
    return readCameraSnapshot(resolveSdkRoot())
  })
  ipcMain.handle(IPC_CHANNELS.sdkCameraSettings, async (event) => {
    requireWizardSender(IPC_CHANNELS.sdkCameraSettings, event)
    // 深链平台单源（cameras.ts）：darwin 原串不变，win32 → Windows 隐私设置，其余 no-op
    const url = cameraSettingsUrlFor(process.platform)
    if (url !== null) await shell.openExternal(url)
  })

  ipcMain.handle(IPC_CHANNELS.sdkDeviceSkins, async (): Promise<DeviceSkinSummary[]> => {
    const cached = cachedSkins()
    if (cached !== null) return cached.map(toSkinSummary)
    const root = resolveRoot(undefined)
    const [sdkSkins, imported] = await Promise.all([
      scanSdkSkins(root),
      scanImportedSkins(app.getPath('userData'))
    ])
    const next = [...sdkSkins, ...imported]
    setSkinsCache(next)
    return next.map(toSkinSummary)
  })

  // null = 用户取消（选择器/同意框）：契约上不走错误通道，renderer 静默早退
  ipcMain.handle(
    IPC_CHANNELS.wizardChooseDeviceSkin,
    async (event): Promise<DeviceSkinSummary | null> => {
      requireWizardSender(IPC_CHANNELS.wizardChooseDeviceSkin, event)
      const wizard = BrowserWindow.fromWebContents(event.sender)
      if (wizard === null) {
        throw new Error(`${IPC_CHANNELS.wizardChooseDeviceSkin}: ${msg('wizardChooseUnavailable')}`)
      }
      const picked = await dialog.showOpenDialog(wizard, {
        title: msg('importSkinDialogTitle'),
        filters: [{ name: msg('skinArchiveFilterName'), extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) {
        return null
      }
      const record = await importSkinArchive(picked.filePaths[0], app.getPath('userData'))
      setSkinsCache(null)
      return toSkinSummary(record)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.sdkDownloadDeviceSkin,
    async (event, raw: unknown): Promise<DeviceSkinSummary | null> => {
      requireWizardSender(IPC_CHANNELS.sdkDownloadDeviceSkin, event)
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`${IPC_CHANNELS.sdkDownloadDeviceSkin}${msg('invalidPayload')}`)
      }
      // 皮肤写入应用数据目录（不动 SDK 根）：共享只读不拦，迁移在途拦
      assertSdkWritable(IPC_CHANNELS.sdkDownloadDeviceSkin, false)
      const skinName = (raw as Record<string, unknown>).skinName
      if (typeof skinName !== 'string' || officialSkinName(skinName) === null) {
        throw new Error(`${IPC_CHANNELS.sdkDownloadDeviceSkin}: ${msg('invalidSkinName')}`)
      }
      if (skinDownloading) {
        throw new Error(msg('skinDownloadBusy', { skin: skinDownloading }))
      }
      skinDownloading = skinName
      try {
        const consentPath = join(app.getPath('userData'), 'official-skin-consent.txt')
        const accepted = await readFile(consentPath, 'utf8').then(
          (value) => value === 'android-studio-device-art',
          () => false
        )
        if (!accepted) {
          const wizard = BrowserWindow.fromWebContents(event.sender)
          if (!wizard) throw new Error(msg('wizardWindowClosed'))
          const result = await dialog.showMessageBox(wizard, {
            title: msg('skinConsentTitle'),
            message: msg('skinConsentMessage'),
            detail: msg('skinConsentDetail', { url: SKIN_SOURCE_URL }),
            buttons: [msg('skinConsentContinue'), msg('dialogCancel')],
            cancelId: 1
          })
          if (result.response !== 0) return null
          await writeFile(consentPath, 'android-studio-device-art')
        }
        const record = await downloadSkin(skinName, app.getPath('userData'), (percent) => {
          const progress: SdkSkinProgress = { skinName, percent }
          pushToAllWindows(IPC_CHANNELS.sdkSkinProgress, progress)
        })
        setSkinsCache(null)
        return toSkinSummary(record)
      } finally {
        skinDownloading = null
      }
    }
  )
}
