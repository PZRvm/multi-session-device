import { BrowserWindow, dialog } from 'electron'
import { stat } from 'node:fs/promises'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceProfile, ImageCatalogResult, SdkProgress, SdkSourceMode } from '@shared/types'
import { appIcon } from '../app-icon'
import { detectSdk } from './sdk'
import { avdmanagerPathFor, listDeviceProfiles } from './profiles'
import { jarFingerprint, sdklibJarPathFor } from './profileMetadata'
import { wizardOwns } from '../window/wizard'
import { settingsOwns } from '../window/settings'
import { isMigrationActive } from './sdkMigration'
import { isSharedReadOnly, javaBinFor, javaHomeFor, resolveSdkRoot } from './sdkSource'
import type { PurgeAppOwnedResult } from './sdkSourceSwitch'
import { msg } from '../locale'
import type { SkinRecord } from './skins'

/** registerSdkIpc 可选依赖（默认空实现）：镜像删除守卫的设备引用查询 */
export interface SdkIpcDeps {
  savedDeviceSkinRef?: (id: string) => Promise<string | null>
  referencingDeviceNames?: (packageName: string) => string[]
  /** 清除保留根后的设备级联删除（devices 域注入；缺席则只清 SDK 不动设备） */
  purgeAppOwnedDevices?: () => Promise<PurgeAppOwnedResult>
  /** 项目自有设备计数（清除确认框级联警告用） */
  appOwnedDeviceCount?: () => Promise<number>
}

export const resolveRoot = (raw: unknown): string => {
  // 缺省走 sdkSource 统一解析（managed/custom/shared-studio 活动根）
  if (raw === undefined || raw === null) return resolveSdkRoot()
  if (typeof raw === 'string' && raw.length > 0) return raw
  throw new Error(`sdk: ${msg('sdkInvalidRoot')}`)
}

export const pushToAllWindows = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

export const pushProgress = (progress: SdkProgress): void =>
  pushToAllWindows(IPC_CHANNELS.sdkProgress, progress)

/** 许可确认——PRD 4.5：必须应用内确认，不静默接受；返回是否同意（拒绝=用户取消） */
export const confirmLicenses = async (): Promise<boolean> => {
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
  // 布尔返回而非抛错（review P2-2）：拒绝 = 用户主动取消，调用方静默处理——
  // 不再依赖错误文本匹配的跨函数契约
  return result.response === 0
}

// ---- 画像缓存（5min）：avdmanager list device 是 Java 子进程（秒级），不必每次向导都跑。
// 键含 SDK 根 + sdklib JAR 指纹——切 SDK 或升级 cmdline-tools 后失效。
let profilesCache: { at: number; key: string; profiles: DeviceProfile[] } | null = null
const PROFILES_CACHE_MS = 300_000

/**
 * 画像清单（带缓存）：sdk:profiles 与 sdk:wizard-capabilities 共用——能力查询
 * 随画像/镜像切换高频触发，直跑 avdmanager 每次秒级 Java 太重（review P2-3）。
 * 创建事务仍走 listDeviceProfiles 直查保新鲜（拒绝陈旧选择的设计不变）。
 */
export const profilesCached = async (root: string): Promise<DeviceProfile[]> => {
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

// ---- 镜像清单缓存（60s）：向导内反复进出不打 manifest ----
let imagesCache: { at: number; root: string; result: ImageCatalogResult } | null = null
const IMAGES_CACHE_MS = 60_000

/** 60s 时效内的缓存命中（sdkImages 展示路径）；过期返回 null */
export const freshImagesFor = (root: string, now: number): ImageCatalogResult | null =>
  imagesCache !== null && imagesCache.root === root && now - imagesCache.at < IMAGES_CACHE_MS
    ? imagesCache.result
    : null

/** root 匹配即命中、不看时效（卸载/下载的守卫路径——宁可旧数据不冒充最新） */
export const imagesFor = (root: string): ImageCatalogResult | null =>
  imagesCache !== null && imagesCache.root === root ? imagesCache.result : null

export const cacheImages = (root: string, result: ImageCatalogResult): void => {
  imagesCache = { at: Date.now(), root, result }
}

/** 下载/卸载改变已装状态时失效 */
export const invalidateImagesCache = (): void => {
  imagesCache = null
}

// ---- 镜像下载互斥 + 实时任务快照：同一时刻只允许一个下载（需求只约束「下载
// 完成前不能创建」）；进度随推送更新，向导重开经 sdk:images 的 activeDownload 恢复。
// abort/done 服务显式取消（plan 2026-10-06-download-cancel）：收尾完成才释放互斥 ----
export interface ActiveDownload {
  packageName: string
  percent: number
  abort: AbortController
  done: Promise<unknown>
}
let downloading: ActiveDownload | null = null

export const activeDownload = (): ActiveDownload | null => downloading
export const setActiveDownload = (task: ActiveDownload): void => {
  downloading = task
}
export const clearActiveDownload = (): void => {
  downloading = null
}

// ---- 皮肤清单缓存（导入/下载后失效）；下载互斥在皮肤分组内私有 ----
let skinsCache: SkinRecord[] | null = null

export const cachedSkins = (): SkinRecord[] | null => skinsCache
export const setSkinsCache = (next: SkinRecord[] | null): void => {
  skinsCache = next
}

/** 向导专用通道的 sender 守卫（plan 设计 9）：非向导窗调用直接拒绝 */
export const requireWizardSender = (channel: string, event: Electron.IpcMainInvokeEvent): void => {
  if (!wizardOwns(event.sender)) {
    throw new Error(`${channel}${msg('wizardCallerNotAllowed')}`)
  }
}

/** 设置窗专用通道的 sender 守卫（SDK 来源域 plan 2026-10-11）：非设置窗调用直接拒绝 */
export const requireSettingsSender = (
  channel: string,
  event: Electron.IpcMainInvokeEvent
): void => {
  if (!settingsOwns(event.sender)) {
    throw new Error(`${channel}${msg('settingsCallerNotAllowed')}`)
  }
}

/**
 * SDK 写操作守卫（plan §6/预检双闸）：共享 Studio SDK 只读——包安装/卸载/bootstrap
 * 全拒；迁移在途（journal 内存标志）SDK 域只读。同步零 await——守卫不给调用方加
 * 异步跳数。皮肤下载只写应用数据目录，仅拦迁移。
 */
export const assertSdkWritable = (channel: string, sharedAlso = true): void => {
  if (sharedAlso && isSharedReadOnly()) {
    throw new Error(`${channel}: ${msg('sdkSharedReadOnly')}`)
  }
  if (isMigrationActive()) {
    throw new Error(`${channel}: ${msg('sdkMigrationBusy')}`)
  }
}

/** 来源切换载荷守卫：target 闭集 + customPath 可选字符串（renderer 载荷不可信） */
export const readSourceTargetInput = (
  raw: unknown
): { target: SdkSourceMode; customPath?: string } => {
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

export const requireSdkReady = async (root: string): Promise<void> => {
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
