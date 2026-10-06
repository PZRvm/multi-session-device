import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkImageProgress, SdkProgress, SdkSnapshot } from '@shared/types'
import { appIcon } from '../app-icon'
import { bootstrapSdk, detectSdk, runSdkManagerPackages, uninstallSdkManagerPackage } from './sdk'
import { avdmanagerPathFor, listDeviceProfiles } from './profiles'
import { jarFingerprint, sdklibJarPathFor } from './profileMetadata'
import { listImagesWithState, scanLocalImages, splitPackageName } from './catalog'
import { buildCapabilities, readEmulatorVersion } from './settings'
import {
  downloadSkin,
  importSkinArchive,
  scanImportedSkins,
  scanSdkSkins,
  type SkinRecord
} from './skins'
import { wizardOwns } from '../window/wizard'
import { assertUninstallable } from './uninstall'
import { activePackageOp, beginPackageOp, endPackageOp } from './packageOps'
import { listWebcams } from './cameras'
import type {
  DeviceProfile,
  DeviceSkinSummary,
  SdkUninstallState,
  ImageCatalogResult,
  SdkSkinProgress,
  WizardCapabilities
} from '@shared/types'

/** 应用自有 SDK 根（PRD E：userData/AndroidSDK；设置自定义路径属 stage 05） */
export const defaultSdkRoot = (): string => join(app.getPath('userData'), 'AndroidSDK')

/** 应用自有 AVD 根（ANDROID_AVD_HOME 语义） */
export const defaultAvdHome = (): string => join(app.getPath('userData'), 'avd-home')

const resolveRoot = (raw: unknown): string => {
  if (raw === undefined || raw === null) return defaultSdkRoot()
  if (typeof raw === 'string' && raw.length > 0) return raw
  throw new Error('sdk: 非法的 SDK 根')
}

const pushToAllWindows = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

const pushProgress = (progress: SdkProgress): void =>
  pushToAllWindows(IPC_CHANNELS.sdkProgress, progress)

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

// 画像缓存（5min）：avdmanager list device 是 Java 子进程（秒级），不必每次向导都跑。
// 键含 SDK 根 + sdklib JAR 指纹——切 SDK 或升级 cmdline-tools 后失效。
let profilesCache: { at: number; key: string; profiles: DeviceProfile[] } | null = null
const PROFILES_CACHE_MS = 300_000

// 镜像清单缓存（60s）：向导内反复进出不打 manifest
let imagesCache: { at: number; root: string; result: ImageCatalogResult } | null = null
const IMAGES_CACHE_MS = 60_000

// 镜像下载互斥 + 实时任务快照：同一时刻只允许一个下载（需求只约束「下载
// 完成前不能创建」）；进度随推送更新，向导重开经 sdk:images 的 activeDownload 恢复
let downloading: { packageName: string; percent: number } | null = null

// 皮肤清单缓存（导入/下载后失效）与皮肤下载互斥
let skinsCache: SkinRecord[] | null = null
let skinDownloading: string | null = null

const toSkinSummary = (record: SkinRecord): DeviceSkinSummary => {
  const portrait = record.layout.portrait
  if (portrait === null) {
    throw new Error(`皮肤 ${record.id} 缺 portrait 布局，不应入库`)
  }
  return {
    id: record.id,
    name: record.name,
    skinRef: record.skinRef,
    source: record.source,
    portrait: {
      frameWidth: portrait.frameWidth,
      frameHeight: portrait.frameHeight,
      screenWidth: portrait.screenWidth,
      screenHeight: portrait.screenHeight
    }
  }
}

/** 向导专用通道的 sender 守卫（plan 设计 9）：非向导窗调用直接拒绝 */
const requireWizardSender = (channel: string, event: Electron.IpcMainInvokeEvent): void => {
  if (!wizardOwns(event.sender)) {
    throw new Error(`${channel}: 非向导窗调用`)
  }
}

const requireSdkReady = async (root: string): Promise<void> => {
  const snapshot = await detectSdk(root)
  if (!snapshot.cmdlineTools.present || !snapshot.jre.present) {
    throw new Error('SDK 尚未就绪（缺 cmdline-tools 或 JRE），先完成 SDK 引导')
  }
}

/** registerSdkIpc 可选依赖（默认空实现）：镜像删除守卫的设备引用查询 */
export interface SdkIpcDeps {
  referencingDeviceNames?: (packageName: string) => string[]
}

export function registerSdkIpc(deps: SdkIpcDeps = {}): void {
  ipcMain.handle(IPC_CHANNELS.sdkStatus, (_event, raw: unknown): Promise<SdkSnapshot> =>
    detectSdk(resolveRoot(raw))
  )

  ipcMain.handle(IPC_CHANNELS.sdkBootstrap, async (_event, raw: unknown): Promise<SdkSnapshot> => {
    const root = resolveRoot(raw)
    const snapshot = await detectSdk(root)
    if (!snapshot.licensed) await confirmLicenses()
    return bootstrapSdk(root, {}, pushProgress)
  })

  // 画像 = avdmanager 可创建性 + sdklib JAR 官方元数据（分类/屏幕/Play 等）
  ipcMain.handle(IPC_CHANNELS.sdkProfiles, async (): Promise<DeviceProfile[]> => {
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    const key = `${root}|${await jarFingerprint(sdklibJarPathFor(root))}`
    const now = Date.now()
    if (profilesCache && profilesCache.key === key && now - profilesCache.at < PROFILES_CACHE_MS) {
      return profilesCache.profiles
    }
    const profiles = await listDeviceProfiles({
      avdmanagerPath: avdmanagerPathFor(root),
      jarPath: sdklibJarPathFor(root)
    })
    profilesCache = { at: now, key, profiles }
    return profiles
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
        activeDownload: downloading,
        activeUninstall:
          activeOp !== null && activeOp.kind === 'uninstall'
            ? { packageName: activeOp.packageName }
            : null
      }
      if (imagesCache && imagesCache.root === root && now - imagesCache.at < IMAGES_CACHE_MS) {
        return { ...imagesCache.result, ...live }
      }
      const result = await listImagesWithState(root)
      imagesCache = { at: now, root, result }
      return { ...result, ...live }
    }
  )

  // 向导设置能力：按画像×镜像×emulator 版本返回 defaults/枚举/边界/禁用原因。
  // 画像与镜像都从 main 可信数据重查——renderer 只传 id，不信任缓存的画像元数据。
  ipcMain.handle(
    IPC_CHANNELS.sdkWizardCapabilities,
    async (_event, raw: unknown): Promise<WizardCapabilities> => {
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}: 非法的入参`)
      }
      const input = raw as Record<string, unknown>
      if (
        typeof input.profileId !== 'string' ||
        typeof input.imagePackageName !== 'string' ||
        input.profileId.length === 0 ||
        splitPackageName(input.imagePackageName) === null
      ) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}: 非法的画像/镜像标识`)
      }
      const root = resolveRoot(undefined)
      await requireSdkReady(root)
      const profiles = await listDeviceProfiles({
        avdmanagerPath: avdmanagerPathFor(root),
        jarPath: sdklibJarPathFor(root)
      })
      const profile = profiles.find((entry) => entry.id === input.profileId)
      if (profile === undefined) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}: 画像不存在或不可创建`)
      }
      const local = await scanLocalImages(root)
      const imageRecord = local.get(input.imagePackageName)
      if (imageRecord === undefined) {
        throw new Error(`${IPC_CHANNELS.sdkWizardCapabilities}: 镜像未安装，能力不可用`)
      }
      const capabilities = buildCapabilities({
        profile,
        imagePackageName: input.imagePackageName,
        emulatorVersion: await readEmulatorVersion(root)
      })
      // 皮肤能力：SDK 已装 + 导入库的 skinRef（皮肤域开放，字段解锁）
      const [sdkSkins, importedSkins] = await Promise.all([
        scanSdkSkins(root),
        scanImportedSkins(app.getPath('userData'))
      ])
      capabilities.skinIds = [...sdkSkins, ...importedSkins].map((record) => record.skinRef)
      capabilities.fields.skinRef =
        capabilities.skinIds.length > 0
          ? { disabledReason: null, min: null, max: null, step: null }
          : {
              disabledReason: '未找到可用皮肤（SDK 未装或库为空）',
              min: null,
              max: null,
              step: null
            }
      // 摄像头能力：宿主枚举（失败不禁用字段，只是没有 webcam 选项）
      try {
        capabilities.webcamDeviceIds = (await listWebcams(root)).map((entry) => entry.id)
      } catch {
        capabilities.webcamDeviceIds = []
      }
      return capabilities
    }
  )

  // ---- 机型皮肤域（plan 设计 6/9）：清单只读（主窗+向导）；导入与下载仅向导窗 ----

  ipcMain.handle(IPC_CHANNELS.sdkDeviceSkins, async (): Promise<DeviceSkinSummary[]> => {
    if (skinsCache !== null) return skinsCache.map(toSkinSummary)
    const root = resolveRoot(undefined)
    const [sdkSkins, imported] = await Promise.all([
      scanSdkSkins(root),
      scanImportedSkins(app.getPath('userData'))
    ])
    skinsCache = [...sdkSkins, ...imported]
    return skinsCache.map(toSkinSummary)
  })

  ipcMain.handle(IPC_CHANNELS.wizardChooseDeviceSkin, async (event): Promise<DeviceSkinSummary> => {
    requireWizardSender(IPC_CHANNELS.wizardChooseDeviceSkin, event)
    const wizard = BrowserWindow.fromWebContents(event.sender)
    if (wizard === null) {
      throw new Error(`${IPC_CHANNELS.wizardChooseDeviceSkin}: 向导窗已不可用`)
    }
    const picked = await dialog.showOpenDialog(wizard, {
      title: '导入机型皮肤压缩包',
      filters: [{ name: '皮肤压缩包', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (picked.canceled || picked.filePaths.length === 0) {
      throw new Error('未选择皮肤压缩包')
    }
    const record = await importSkinArchive(picked.filePaths[0], app.getPath('userData'))
    skinsCache = null
    return toSkinSummary(record)
  })

  ipcMain.handle(
    IPC_CHANNELS.sdkDownloadDeviceSkin,
    async (event, raw: unknown): Promise<DeviceSkinSummary> => {
      requireWizardSender(IPC_CHANNELS.sdkDownloadDeviceSkin, event)
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`${IPC_CHANNELS.sdkDownloadDeviceSkin}: 非法的入参`)
      }
      const skinName = (raw as Record<string, unknown>).skinName
      if (typeof skinName !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(skinName)) {
        throw new Error(`${IPC_CHANNELS.sdkDownloadDeviceSkin}: 非法的皮肤名`)
      }
      if (skinDownloading) {
        throw new Error(`已有皮肤在下载（${skinDownloading}），请等待完成`)
      }
      skinDownloading = skinName
      try {
        const record = await downloadSkin(skinName, app.getPath('userData'), (percent) => {
          const progress: SdkSkinProgress = { skinName, percent }
          pushToAllWindows(IPC_CHANNELS.sdkSkinProgress, progress)
        })
        skinsCache = null
        return toSkinSummary(record)
      } finally {
        skinDownloading = null
      }
    }
  )

  // 卸载已装镜像（plan 2026-10-06-image-uninstall）：守卫链（uninstall.ts 纯函数，
  // 顺序固定）→ 官方 --uninstall → 落盘复核 → 缓存失效
  ipcMain.handle(IPC_CHANNELS.sdkUninstallImage, async (_event, raw: unknown): Promise<void> => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).packageName !== 'string'
    ) {
      throw new Error(`${IPC_CHANNELS.sdkUninstallImage}: 非法的入参`)
    }
    const packageName = (raw as Record<string, unknown>).packageName as string
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    const catalog =
      imagesCache && imagesCache.root === root
        ? imagesCache.result
        : await listImagesWithState(root)
    assertUninstallable(packageName, {
      catalog,
      activeOp: activePackageOp(),
      referencing: deps.referencingDeviceNames?.(packageName) ?? []
    })
    beginPackageOp({ kind: 'uninstall', packageName })
    try {
      try {
        await uninstallSdkManagerPackage(root, packageName)
      } catch (error) {
        // 终态广播（发起窗口可能已关——错误只 throw 给 invoke 方对它无意义）
        pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
          packageName,
          error: error instanceof Error ? error.message : String(error)
        } satisfies SdkUninstallState)
        throw error
      }
      pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
        packageName
      } satisfies SdkUninstallState)
      // 落盘复核：直接探测包目录存在性（scanLocalImages 只认带 package.xml 的
      // 目录——非标准残留会被它漏掉，review 2026-10-06 P2）
      const parts = splitPackageName(packageName)
      if (parts !== null) {
        const dir = join(root, 'system-images', parts.platformSegment, parts.tagSegment, parts.abi)
        const dirExists = await stat(dir).then(
          () => true,
          () => false
        )
        if (dirExists) {
          throw new Error(`卸载后仍检测到残留目录（${dir}），可手动清理后刷新清单`)
        }
      }
      imagesCache = null
    } finally {
      endPackageOp()
    }
  })

  ipcMain.handle(IPC_CHANNELS.sdkDownloadImage, async (_event, raw: unknown): Promise<void> => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).packageName !== 'string'
    ) {
      throw new Error(`${IPC_CHANNELS.sdkDownloadImage}: 非法的入参`)
    }
    const packageName = (raw as Record<string, unknown>).packageName as string
    // 守卫从固定正则升级为可信目录核验：包必须出现在当前 manifest/本地扫描结果里
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    const catalog =
      imagesCache && imagesCache.root === root
        ? imagesCache.result
        : await listImagesWithState(root)
    const entry = catalog.images.find((image) => image.packageName === packageName)
    if (entry === undefined) {
      throw new Error(`${IPC_CHANNELS.sdkDownloadImage}: 包 ${packageName} 不在可信镜像目录中`)
    }
    if (entry.abi !== 'arm64-v8a') {
      throw new Error(`${IPC_CHANNELS.sdkDownloadImage}: 跨架构镜像（${entry.abi}）本期不支持下载`)
    }
    beginPackageOp({ kind: 'download', packageName })
    downloading = { packageName, percent: 0 }
    try {
      // 下载会改变已装状态——失效清单缓存
      imagesCache = null
      await runSdkManagerPackages(root, [packageName], (percent) => {
        if (downloading !== null) downloading.percent = percent
        const progress: SdkImageProgress = { packageName, percent, message: `下载 ${packageName}` }
        pushToAllWindows(IPC_CHANNELS.sdkImageProgress, progress)
      })
    } catch (error) {
      // 发起下载的向导窗可能已关闭（invoke 拒绝对它无意义）——失败广播给
      // 在听的窗口，重开的向导据此显示错误与重试入口（plan 设计 9）
      const message = error instanceof Error ? error.message : String(error)
      pushToAllWindows(IPC_CHANNELS.sdkImageProgress, {
        packageName,
        percent: 0,
        message: `下载失败 ${packageName}`,
        error: message
      } satisfies SdkImageProgress)
      throw error
    } finally {
      downloading = null
      endPackageOp()
    }
  })
}
