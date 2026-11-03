import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkSnapshot, SdkSourceSnapshot, StudioSdkDetection } from '@shared/types'
import { bootstrapSdk, detectSdk } from './sdk'
import { msg } from '../locale'
import {
  confirmLicenses,
  pushProgress,
  readSourceTargetInput,
  requireSettingsSender,
  resolveRoot,
  assertSdkWritable,
  type SdkIpcDeps
} from './sdkIpcShared'
import {
  adoptSourceSwitch,
  cancelSourceMigration,
  clearRetainedWithCascade,
  createSwitchDeps,
  startSourceMigration,
  switchSource
} from './sdkSourceSwitch'
import { runStudioDetection } from './studioDetect'
import { getSdkSourceSnapshot } from './sdkSource'

/** SDK 状态 + 来源域 handler（plan 2026-10-11-sdk-source-switching；仅设置窗）+ bootstrap */
export function registerSdkSourceIpc(deps: SdkIpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.sdkStatus, (_event, raw: unknown): Promise<SdkSnapshot> =>
    detectSdk(resolveRoot(raw))
  )

  ipcMain.handle(IPC_CHANNELS.sdkSourceGet, (event): Promise<SdkSourceSnapshot> => {
    requireSettingsSender(IPC_CHANNELS.sdkSourceGet, event)
    return getSdkSourceSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.sdkDetectStudio, (event): Promise<StudioSdkDetection> => {
    requireSettingsSender(IPC_CHANNELS.sdkDetectStudio, event)
    return runStudioDetection()
  })

  ipcMain.handle(IPC_CHANNELS.sdkSourceSet, (event, raw: unknown) => {
    requireSettingsSender(IPC_CHANNELS.sdkSourceSet, event)
    return switchSource(readSourceTargetInput(raw))
  })

  ipcMain.handle(IPC_CHANNELS.sdkSourceMigrate, async (event, raw: unknown) => {
    requireSettingsSender(IPC_CHANNELS.sdkSourceMigrate, event)
    const input = readSourceTargetInput(raw)
    const replace =
      typeof (raw as Record<string, unknown> | null)?.replace === 'boolean'
        ? ((raw as Record<string, unknown>).replace as boolean)
        : false
    return startSourceMigration({ ...input, replace })
  })

  ipcMain.handle(IPC_CHANNELS.sdkSourceAdopt, (event, raw: unknown) => {
    requireSettingsSender(IPC_CHANNELS.sdkSourceAdopt, event)
    return adoptSourceSwitch(readSourceTargetInput(raw))
  })

  ipcMain.handle(IPC_CHANNELS.sdkSourceMigrateCancel, (event) => {
    requireSettingsSender(IPC_CHANNELS.sdkSourceMigrateCancel, event)
    return cancelSourceMigration()
  })

  ipcMain.handle(IPC_CHANNELS.sdkSourceClearRetained, async (event, raw: unknown) => {
    requireSettingsSender(IPC_CHANNELS.sdkSourceClearRetained, event)
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).root !== 'string'
    ) {
      throw new Error(msg('invalidPayload'))
    }
    // 级联编排下沉 clearRetainedWithCascade（review P2-3：顺序与失败聚合有域测），
    // 这里只留守卫与本地化上报
    const { snapshot, failures } = await clearRetainedWithCascade(
      { root: (raw as Record<string, unknown>).root as string },
      { ...createSwitchDeps(), purgeAppOwnedDevices: deps.purgeAppOwnedDevices }
    )
    if (failures.length > 0) {
      throw new Error(
        msg('sdkClearPurgeFailed', {
          failures: failures.map((entry) => `${entry.name}：${entry.message}`).join('；')
        })
      )
    }
    return snapshot
  })

  // 清除确认框的级联计数（仅设置窗）：项目自有设备全体将被连带删除
  ipcMain.handle(IPC_CHANNELS.sdkAppOwnedCount, async (event): Promise<number> => {
    requireSettingsSender(IPC_CHANNELS.sdkAppOwnedCount, event)
    return deps.appOwnedDeviceCount !== undefined ? deps.appOwnedDeviceCount() : 0
  })

  // 原生目录选择器（自选 SDK 根）：null = 用户取消，不走错误通道
  ipcMain.handle(IPC_CHANNELS.sdkChooseCustomRoot, async (event): Promise<string | null> => {
    requireSettingsSender(IPC_CHANNELS.sdkChooseCustomRoot, event)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window === null) throw new Error(msg('loadSettingsFailed', { detail: 'window gone' }))
    const picked = await dialog.showOpenDialog(window, {
      title: msg('chooseSdkRootTitle'),
      properties: ['openDirectory', 'createDirectory']
    })
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.sdkBootstrap, async (_event, raw: unknown): Promise<SdkSnapshot> => {
    assertSdkWritable(IPC_CHANNELS.sdkBootstrap)
    const root = resolveRoot(raw)
    const snapshot = await detectSdk(root)
    if (!snapshot.licensed) {
      // 许可拒绝 = 用户主动取消（非失败）：静默返回当前态，不进错误通道
      if (!(await confirmLicenses())) return snapshot
    }
    return bootstrapSdk(root, {}, pushProgress)
  })
}
