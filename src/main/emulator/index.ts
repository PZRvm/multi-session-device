import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkImageProgress, SdkProgress, SdkSnapshot } from '@shared/types'
import { appIcon } from '../app-icon'
import { bootstrapSdk, detectSdk, runSdkManagerPackages } from './sdk'
import { avdmanagerPathFor, listDeviceProfiles } from './profiles'
import { listImagesWithState } from './catalog'
import type { DeviceProfile, ImageEntry } from '@shared/types'

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

// 画像缓存（5min）：avdmanager list device 是 Java 子进程（秒级），不必每次向导都跑
let profilesCache: { at: number; profiles: DeviceProfile[] } | null = null
const PROFILES_CACHE_MS = 300_000

// 镜像清单缓存（60s）：向导内反复进出不打 manifest
let imagesCache: { at: number; root: string; images: ImageEntry[] } | null = null
const IMAGES_CACHE_MS = 60_000

// 镜像下载互斥：同一时刻只允许一个下载（需求只约束「下载完成前不能创建」）
let downloading: string | null = null

const requireSdkReady = async (root: string): Promise<void> => {
  const snapshot = await detectSdk(root)
  if (!snapshot.cmdlineTools.present || !snapshot.jre.present) {
    throw new Error('SDK 尚未就绪（缺 cmdline-tools 或 JRE），先完成 SDK 引导')
  }
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

  // 画像来自 avdmanager list device（手机/平板过滤；5min 缓存）
  ipcMain.handle(IPC_CHANNELS.sdkProfiles, async (): Promise<DeviceProfile[]> => {
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    const now = Date.now()
    if (profilesCache && now - profilesCache.at < PROFILES_CACHE_MS) {
      return profilesCache.profiles
    }
    const profiles = await listDeviceProfiles({ avdmanagerPath: avdmanagerPathFor(root) })
    profilesCache = { at: now, profiles }
    return profiles
  })

  ipcMain.handle(IPC_CHANNELS.sdkImages, async (_event, raw: unknown): Promise<ImageEntry[]> => {
    const root = resolveRoot(raw)
    const now = Date.now()
    if (imagesCache && imagesCache.root === root && now - imagesCache.at < IMAGES_CACHE_MS) {
      return imagesCache.images
    }
    const images = await listImagesWithState(root)
    imagesCache = { at: now, root, images }
    return images
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
    if (
      !/^system-images;android-\d+;(default|google_apis|google_apis_playstore);arm64-v8a$/.test(
        packageName
      )
    ) {
      throw new Error(`${IPC_CHANNELS.sdkDownloadImage}: 未知镜像包 ${packageName}`)
    }
    if (downloading) throw new Error(`已有镜像在下载（${downloading}），请等待完成`)
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    downloading = packageName
    try {
      // 下载会改变已装状态——失效清单缓存
      imagesCache = null
      await runSdkManagerPackages(root, [packageName], (percent) => {
        const progress: SdkImageProgress = { packageName, percent, message: `下载 ${packageName}` }
        pushToAllWindows(IPC_CHANNELS.sdkImageProgress, progress)
      })
    } finally {
      downloading = null
    }
  })
}
