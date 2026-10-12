import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { stat, readFile, writeFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkImageProgress, SdkProgress, SdkSnapshot } from '@shared/types'
import { appIcon } from '../app-icon'
import { bootstrapSdk, detectSdk, uninstallSdkManagerPackage } from './sdk'
import { avdmanagerPathFor, listDeviceProfiles } from './profiles'
import { jarFingerprint, sdklibJarPathFor } from './profileMetadata'
import { listImagesWithState, scanLocalImages, splitPackageName } from './catalog'
import { downloadImagePackage } from './downloader'
import { buildEnrichedCapabilities, readEmulatorVersion } from './settings'
import { importSkinArchive, scanImportedSkins, scanSdkSkins, type SkinRecord } from './skins'
import { downloadSkin, officialSkinName, SKIN_SOURCE_URL } from './skinSource'
import { readSkinPresentation } from './skinPresentation'
import { readCameraSnapshot, requestCameraPermission } from './cameras'
import { getMainWindow } from '../window'
import { wizardOwns } from '../window/wizard'
import { settingsOwns } from '../window/settings'
import { assertUninstallable } from './uninstall'
import { activePackageOp, beginPackageOp, endPackageOp, isPackageCreating } from './packageOps'
import type {
  DeviceProfile,
  DeviceSkinSummary,
  ImageCatalogResult,
  SdkSkinProgress,
  SdkSourceSnapshot,
  SdkUninstallState,
  StudioSdkDetection,
  WizardCapabilities
} from '@shared/types'
import { msg } from '../locale'
import {
  getSdkSourceSnapshot,
  getSdkSourceState,
  isSharedReadOnly,
  javaBinFor,
  javaHomeFor,
  resolveSdkRoot
} from './sdkSource'
import { runStudioDetection } from './studioDetect'
import { isMigrationActive } from './sdkMigration'
import {
  adoptSourceSwitch,
  cancelSourceMigration,
  clearRetainedRoot,
  onSdkSourceChanged,
  startSourceMigration,
  switchSource
} from './sdkSourceSwitch'
import type { SdkSourceMode } from '@shared/types'

/** 应用自有 AVD 根（ANDROID_AVD_HOME 语义） */
export const defaultAvdHome = (): string => join(app.getPath('userData'), 'avd-home')

// 来源变更监听（sdkSourceSwitch 定义）：ipc/index.ts 登记点接线 devices 重查
export { onSdkSourceChanged }

const resolveRoot = (raw: unknown): string => {
  // 缺省走 sdkSource 统一解析（managed/custom/shared-studio 活动根）
  if (raw === undefined || raw === null) return resolveSdkRoot()
  if (typeof raw === 'string' && raw.length > 0) return raw
  throw new Error(`sdk: ${msg('sdkInvalidRoot')}`)
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
    title: msg('licenseTitle'),
    message: msg('licenseMessage'),
    detail: msg('licenseDetail'),
    buttons: [msg('licenseAccept'), msg('licenseReject')],
    cancelId: 1,
    icon: appIcon
  }
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 0) throw new Error(msg('licenseRejected'))
}

// 画像缓存（5min）：avdmanager list device 是 Java 子进程（秒级），不必每次向导都跑。
// 键含 SDK 根 + sdklib JAR 指纹——切 SDK 或升级 cmdline-tools 后失效。
let profilesCache: { at: number; key: string; profiles: DeviceProfile[] } | null = null
const PROFILES_CACHE_MS = 300_000

/**
 * 画像清单（带缓存）：sdk:profiles 与 sdk:wizard-capabilities 共用——能力查询
 * 随画像/镜像切换高频触发，直跑 avdmanager 每次秒级 Java 太重（review P2-3）。
 * 创建事务仍走 listDeviceProfiles 直查保新鲜（拒绝陈旧选择的设计不变）。
 */
const profilesCached = async (root: string): Promise<DeviceProfile[]> => {
  const key = `${root}|${await jarFingerprint(sdklibJarPathFor(root))}`
  const now = Date.now()
  if (profilesCache && profilesCache.key === key && now - profilesCache.at < PROFILES_CACHE_MS) {
    return profilesCache.profiles
  }
  const profiles = await listDeviceProfiles({
    sdkRoot: root,
    javaHome: javaHomeFor(root),
    avdmanagerPath: avdmanagerPathFor(root),
    jarPath: sdklibJarPathFor(root)
  })
  profilesCache = { at: now, key, profiles }
  return profiles
}

// 镜像清单缓存（60s）：向导内反复进出不打 manifest
let imagesCache: { at: number; root: string; result: ImageCatalogResult } | null = null
const IMAGES_CACHE_MS = 60_000

// 镜像下载互斥 + 实时任务快照：同一时刻只允许一个下载（需求只约束「下载
// 完成前不能创建」）；进度随推送更新，向导重开经 sdk:images 的 activeDownload 恢复。
// abort/done 服务显式取消（plan 2026-10-06-download-cancel）：收尾完成才释放互斥
let downloading: {
  packageName: string
  percent: number
  abort: AbortController
  done: Promise<unknown>
} | null = null

// 皮肤清单缓存（导入/下载后失效）与皮肤下载互斥
let skinsCache: SkinRecord[] | null = null
let skinDownloading: string | null = null

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

/** 向导专用通道的 sender 守卫（plan 设计 9）：非向导窗调用直接拒绝 */
const requireWizardSender = (channel: string, event: Electron.IpcMainInvokeEvent): void => {
  if (!wizardOwns(event.sender)) {
    throw new Error(`${channel}${msg('wizardCallerNotAllowed')}`)
  }
}

/** 设置窗专用通道的 sender 守卫（SDK 来源域 plan 2026-10-11）：非设置窗调用直接拒绝 */
const requireSettingsSender = (channel: string, event: Electron.IpcMainInvokeEvent): void => {
  if (!settingsOwns(event.sender)) {
    throw new Error(`${channel}${msg('settingsCallerNotAllowed')}`)
  }
}

/**
 * SDK 写操作守卫（plan §6/预检双闸）：共享 Studio SDK 只读——包安装/卸载/bootstrap
 * 全拒；迁移在途（journal 内存标志）SDK 域只读。同步零 await——守卫不给调用方加
 * 异步跳数。皮肤下载只写应用数据目录，仅拦迁移。
 */
const assertSdkWritable = (channel: string, sharedAlso = true): void => {
  if (sharedAlso && isSharedReadOnly()) {
    throw new Error(`${channel}: ${msg('sdkSharedReadOnly')}`)
  }
  if (isMigrationActive()) {
    throw new Error(`${channel}: ${msg('sdkMigrationBusy')}`)
  }
}

/** 来源切换载荷守卫：target 闭集 + customPath 可选字符串（renderer 载荷不可信） */
const readSourceTargetInput = (raw: unknown): { target: SdkSourceMode; customPath?: string } => {
  if (typeof raw !== 'object' || raw === null) throw new Error(msg('invalidPayload'))
  const input = raw as Record<string, unknown>
  const target = input.target
  if (target !== 'managed' && target !== 'custom' && target !== 'shared-studio') {
    throw new Error(msg('invalidPayload'))
  }
  if (input.customPath !== undefined && typeof input.customPath !== 'string') {
    throw new Error(msg('invalidPayload'))
  }
  return { target, customPath: input.customPath as string | undefined }
}

const requireSdkReady = async (root: string): Promise<void> => {
  const snapshot = await detectSdk(root)
  // Java 按实际运行来源判定（javaBinFor 单源）：managed/custom = SDK 内置 JRE；
  // shared = Studio JBR——Studio SDK 根没有 <root>/jre 布局，按 detectSdk 的
  // jre 标记判共享态必为「未就绪」（investigate 2026-10-11 根因）
  const javaReady = await stat(javaBinFor(root)).then(
    () => true,
    () => false
  )
  if (!snapshot.cmdlineTools.present || !javaReady) {
    throw new Error(isSharedReadOnly() ? msg('sdkSharedNotReady') : msg('sdkNotReady'))
  }
}

/** registerSdkIpc 可选依赖（默认空实现）：镜像删除守卫的设备引用查询 */
export interface SdkIpcDeps {
  savedDeviceSkinRef?: (id: string) => Promise<string | null>
  referencingDeviceNames?: (packageName: string) => string[]
  /** 清除保留根后的设备级联删除（devices 域注入；缺席则只清 SDK 不动设备） */
  purgeAppOwnedDevices?: () => Promise<{
    deleted: Array<{ id: string; name: string }>
    failures: Array<{ name: string; message: string }>
  }>
  /** 项目自有设备计数（清除确认框级联警告用） */
  appOwnedDeviceCount?: () => Promise<number>
}

export function registerSdkIpc(deps: SdkIpcDeps = {}): void {
  ipcMain.handle(IPC_CHANNELS.sdkStatus, (_event, raw: unknown): Promise<SdkSnapshot> =>
    detectSdk(resolveRoot(raw))
  )

  // ---- SDK 来源域（plan 2026-10-11-sdk-source-switching；仅设置窗）----

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
    const snapshot = await clearRetainedRoot({ root: (raw as Record<string, unknown>).root as string })
    // 设备级联（用户 2026-10-12 批复）：保留 SDK 已删，项目自有设备的镜像永久
    // 消失——设备一并清掉。SDK 删除是用户确认过的主操作，先完成；设备清理逐台
    // best-effort，失败汇总上报（残留行可切回自有根后手删）
    if (deps.purgeAppOwnedDevices !== undefined) {
      const purged = await deps.purgeAppOwnedDevices()
      if (purged.failures.length > 0) {
        throw new Error(
          msg('sdkClearPurgeFailed', {
            failures: purged.failures.map((entry) => `${entry.name}：${entry.message}`).join('；')
          })
        )
      }
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
      try {
        await confirmLicenses()
      } catch (error) {
        // 许可拒绝 = 用户主动取消（非失败）：静默返回当前态，不进错误通道
        // （消息匹配限本进程同 locale，msg 输出即抛出文本）
        if (error instanceof Error && error.message === msg('licenseRejected')) return snapshot
        throw error
      }
    }
    return bootstrapSdk(root, {}, pushProgress)
  })

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
        activeDownload: downloading,
        activeUninstall:
          activeOp !== null && activeOp.kind === 'uninstall'
            ? { packageName: activeOp.packageName }
            : null
      }
      // 共享只读态清单本地化（plan 2026-10-12）：跳过六源 manifest，离线可用；
      // sdkSource 每次新鲜填充（缓存命中也按当前 sdk.json 出，不随缓存陈旧）
      const shared = isSharedReadOnly()
      if (imagesCache && imagesCache.root === root && now - imagesCache.at < IMAGES_CACHE_MS) {
        return { ...imagesCache.result, ...live, sdkSource: getSdkSourceState().source }
      }
      const result = await listImagesWithState(root, {}, { localOnly: shared })
      imagesCache = { at: now, root, result }
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

  // ---- 机型皮肤域（plan 设计 6/9）：清单只读（主窗+向导）；导入与下载仅向导窗 ----

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
    if (process.platform === 'darwin')
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
      )
  })

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
      skinsCache = null
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
      throw new Error(`${IPC_CHANNELS.sdkUninstallImage}${msg('invalidPayload')}`)
    }
    assertSdkWritable(IPC_CHANNELS.sdkUninstallImage)
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
      creating: isPackageCreating(packageName),
      referencing: deps.referencingDeviceNames?.(packageName) ?? []
    })
    beginPackageOp({ kind: 'uninstall', packageName })
    try {
      try {
        await uninstallSdkManagerPackage(root, packageName)
      } catch (error) {
        // 卸载进程失败：终态广播（发起窗口可能已关——错误只 throw 给 invoke 方
        // 对它无意义），文案标注是卸载步骤
        pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
          packageName,
          error: msg('uninstallImageFailed', {
            message: error instanceof Error ? error.message : String(error)
          })
        } satisfies SdkUninstallState)
        throw error
      }
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
          // 复核失败就地广播（重开窗口只依赖广播，不看 invoke 拒绝）
          pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
            packageName,
            error: msg('uninstallResidualDir', { dir })
          } satisfies SdkUninstallState)
          throw new Error(msg('uninstallResidualDir', { dir }))
        }
      }
      imagesCache = null
      // 完成广播必须在复核通过 + 缓存失效之后：广播触发 renderer 重拉清单，
      // 先广播会命中 60s 旧缓存闪回「已安装」（二轮 review P1）
      pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
        packageName
      } satisfies SdkUninstallState)
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
      throw new Error(`${IPC_CHANNELS.sdkDownloadImage}${msg('invalidPayload')}`)
    }
    assertSdkWritable(IPC_CHANNELS.sdkDownloadImage)
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
      throw new Error(
        `${IPC_CHANNELS.sdkDownloadImage}: ${msg('packageNotTrusted', { packageName })}`
      )
    }
    if (entry.abi !== 'arm64-v8a') {
      throw new Error(
        `${IPC_CHANNELS.sdkDownloadImage}: ${msg('crossArchDownloadUnsupported', { abi: entry.abi })}`
      )
    }
    // 统一包操作互斥（packageOps）：拒绝进行中的下载/卸载（文案含包名）；
    // 下载侧的取消链路（abort/done）保留在 downloading 对象上
    beginPackageOp({ kind: 'download', packageName })
    const abort = new AbortController()
    // done 是显式收尾信号：在 finally 里、互斥释放之后 resolve——取消 handler
    // await 它即得到「收尾完成且可立即重下」的硬保证，不依赖微任务顺序（review P2-3）
    // executor 同步执行，finally 里必已赋值——! 是给 TS definiteness 分析的明确标注
    let settleDone!: () => void
    const done = new Promise<void>((resolve) => {
      settleDone = resolve
    })
    downloading = { packageName, percent: 0, abort, done }
    try {
      // 下载会改变已装状态——失效清单缓存
      imagesCache = null
      // 直连下载（plan 2026-10-06-download-progress-zero）：官方 CLI 无进度流，
      // sdkmanager 执行体退役为 bootstrap 等场景；此处用 manifest zip 流式下载。
      const outcome = await downloadImagePackage(
        root,
        {
          packageName,
          zipUrl: entry.zipUrl,
          zipSha1: entry.zipSha1,
          sizeBytes: entry.sizeBytes,
          displayName: entry.displayName,
          apiLevelText:
            entry.api.major === null
              ? entry.api.platformSegment.replace(/^android-/, '')
              : entry.api.minor !== null
                ? `${entry.api.major}.${entry.api.minor}`
                : `${entry.api.major}`,
          extensionLevel: entry.api.extensionLevel,
          tagIds: entry.tagIds,
          abi: entry.abi,
          revision: entry.revision
        },
        (percent) => {
          if (downloading !== null) downloading.percent = percent
          const progress: SdkImageProgress = {
            packageName,
            percent,
            message: `下载 ${packageName}`
          }
          pushToAllWindows(IPC_CHANNELS.sdkImageProgress, progress)
        },
        {},
        abort.signal
      )
      if (outcome === 'canceled') {
        // 取消不是失败：广播给在听窗口（重开的向导清恢复态），无错误横幅
        pushToAllWindows(IPC_CHANNELS.sdkImageProgress, {
          packageName,
          percent: 0,
          message: `已取消 ${packageName}`,
          canceled: true
        } satisfies SdkImageProgress)
        return
      }
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
      settleDone()
    }
  })

  // 显式取消进行中的下载（plan 2026-10-06-download-cancel）：幂等——无任务或
  // 包名不匹配直接成功（迟到/重复点击不报错）；resolve 时点 = 收尾完成（临时
  // 物已清理、互斥已释放），renderer 以此为准本地清状态，广播服务重开窗
  ipcMain.handle(
    IPC_CHANNELS.sdkCancelDownloadImage,
    async (event, raw: unknown): Promise<void> => {
      requireWizardSender(IPC_CHANNELS.sdkCancelDownloadImage, event)
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`${IPC_CHANNELS.sdkCancelDownloadImage}${msg('invalidPayload')}`)
      }
      const packageName = (raw as Record<string, unknown>).packageName
      if (typeof packageName !== 'string') {
        throw new Error(`${IPC_CHANNELS.sdkCancelDownloadImage}: ${msg('invalidPackageName')}`)
      }
      const task = downloading
      if (task === null || task.packageName !== packageName) return
      task.abort.abort()
      // 收尾竞态兜底：下载若恰好以失败告终（与取消同时），等待不吞它的错误路径
      await task.done.catch(() => undefined)
    }
  )
}
