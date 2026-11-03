import { app } from 'electron'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceProfile, ImageCatalogResult, WizardCapabilities } from '@shared/types'
import { scanLocalImages, splitPackageName } from './catalog'
import { buildEnrichedCapabilities, readEmulatorVersion } from './settings'
import { activeDownload } from './sdkIpcShared'
import { activePackageOp } from './packageOps'
import {
  cacheImages,
  freshImagesFor,
  profilesCached,
  requireSdkReady,
  resolveRoot
} from './sdkIpcShared'
import { getSdkSourceState, isSharedReadOnly } from './sdkSource'
import { listImagesWithState } from './catalog'
import { msg } from '../locale'

/** 画像/镜像清单/向导能力 handler（清单带缓存；能力实时核验） */
export function registerSdkCatalogIpc(): void {
  // 画像 = avdmanager 可创建性 + sdklib JAR 官方元数据（分类/屏幕/Play 等）
  ipcMain.handle(IPC_CHANNELS.sdkProfiles, async (): Promise<DeviceProfile[]> => {
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    return profilesCached(root)
  })

  ipcMain.handle(
    IPC_CHANNELS.sdkImages,
    async (_event, raw: unknown): Promise<ImageCatalogResult> => {
      const root = resolveRoot(raw)
      const now = Date.now()
      // activeDownload/activeUninstall 是实时状态：缓存命中也按当前任务合并
      // （重开向导即由此恢复渲染）
      const activeOp = activePackageOp()
      const live = {
        activeDownload: activeDownload(),
        activeUninstall:
          activeOp !== null && activeOp.kind === 'uninstall'
            ? { packageName: activeOp.packageName }
            : null
      }
      // 共享只读态清单本地化（plan 2026-10-12）：跳过六源 manifest，离线可用；
      // sdkSource 每次新鲜填充（缓存命中也按当前 sdk.json 出，不随缓存陈旧）
      const shared = isSharedReadOnly()
      const cached = freshImagesFor(root, now)
      if (cached !== null) {
        return { ...cached, ...live, sdkSource: getSdkSourceState().source }
      }
      const result = await listImagesWithState(root, {}, { localOnly: shared })
      cacheImages(root, result)
      return { ...result, ...live, sdkSource: getSdkSourceState().source }
    }
  )

  // 向导设置能力：按画像×镜像×emulator 版本返回 defaults/枚举/边界/禁用原因。
  // 画像与镜像都从 main 可信数据重查——renderer 只传 id，不信任缓存的画像元数据。
  ipcMain.handle(
    IPC_CHANNELS.sdkWizardCapabilities,
    async (_event, raw: unknown): Promise<WizardCapabilities> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}${msg('invalidPayload')}`)
      }
      const input = raw as Record<string, unknown>
      if (
        typeof input.profileId !== 'string' ||
        typeof input.imagePackageName !== 'string' ||
        input.profileId.length === 0 ||
        splitPackageName(input.imagePackageName) === null
      ) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}${msg('invalidProfileImageId')}`)
      }
      const root = resolveRoot(undefined)
      await requireSdkReady(root)
      // 画像走缓存（review P2-3）：高频路径不再每次秒级 Java；镜像安装仍实时扫描
      const profiles = await profilesCached(root)
      const profile = profiles.find((entry) => entry.id === input.profileId)
      if (profile === undefined) {
        throw new Error(
          `${IPC_CHANNELS.sdkWizardCapabilities}: ${msg('profileMissingOrNotCreatable')}`
        )
      }
      const local = await scanLocalImages(root)
      const imageRecord = local.get(input.imagePackageName)
      if (imageRecord === undefined) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}: ${msg('imageNotInstalledForCaps')}`)
      }
      const capabilities = await buildEnrichedCapabilities(
        {
          profile,
          imagePackageName: input.imagePackageName,
          emulatorVersion: await readEmulatorVersion(root)
        },
        root,
        app.getPath('userData')
      )
      return capabilities
    }
  )
}
