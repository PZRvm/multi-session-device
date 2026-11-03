import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  DeviceProfile,
  CameraSnapshot,
  DeviceSkinPresentation,
  DeviceSkinSummary,
  ImageCatalogResult,
  SdkImageProgress,
  SdkMigrationProgress,
  SdkSourceMode,
  SdkSourceSnapshot,
  SdkSourceSwitchEvaluation,
  SdkUninstallState,
  SdkProgress,
  SdkSkinProgress,
  SdkSnapshot,
  StudioSdkDetection,
  WizardCapabilities
} from '@shared/types'

/** SDK 域白名单：状态探测 + bootstrap（进度经 onProgress 推送） */
export const sdkApi = {
  status: (root?: string): Promise<SdkSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.sdkStatus, root),
  bootstrap: (root?: string): Promise<SdkSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkBootstrap, root),
  /** 来源快照（仅设置窗：sender 守卫在 main；检测读缓存不触发扫描） */
  sourceGet: (): Promise<SdkSourceSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.sdkSourceGet),
  /** 跑 Studio/SDK 检测链并刷新缓存（仅设置窗；版面自动检测与「重新检测」共用） */
  detectStudio: (): Promise<StudioSdkDetection> => ipcRenderer.invoke(IPC_CHANNELS.sdkDetectStudio),
  /** 矩阵判定（仅设置窗）：direct 已执行 / needs-migration / needs-choice / rejected */
  sourceSet: (target: SdkSourceMode, customPath?: string): Promise<SdkSourceSwitchEvaluation> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkSourceSet, { target, customPath }),
  /** 开始迁移（仅设置窗；journal 在场 = 崩溃恢复继续；replace = 迁移替换分支） */
  sourceMigrate: (
    target: SdkSourceMode,
    customPath: string | undefined,
    replace: boolean
  ): Promise<'started'> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkSourceMigrate, { target, customPath, replace }),
  /** 直接使用分支（仅设置窗）：翻 source + relink + 删落选根 */
  sourceAdopt: (target: SdkSourceMode, customPath?: string): Promise<SdkSourceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkSourceAdopt, { target, customPath }),
  /** 取消 = 回滚（仅设置窗；崩溃恢复横幅同入口） */
  sourceMigrateCancel: (): Promise<'done'> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkSourceMigrateCancel),
  /** 清除保留根（仅共享模式；原生确认在 UI 完成；连带删除全部项目自有设备） */
  sourceClearRetained: (root: string): Promise<SdkSourceSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkSourceClearRetained, { root }),
  /** 项目自有设备计数（清除确认框的级联警告） */
  appOwnedDeviceCount: (): Promise<number> => ipcRenderer.invoke(IPC_CHANNELS.sdkAppOwnedCount),
  /** 原生目录选择器选自选 SDK 根（仅设置窗；null = 用户取消） */
  chooseCustomRoot: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkChooseCustomRoot),
  /** 来源变化广播订阅 */
  onSourceChanged: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on(IPC_CHANNELS.sdkSourceChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkSourceChanged, listener)
    }
  },
  /** 迁移进度订阅（100ms 节流 + 阶段切换必推） */
  onMigrateProgress: (callback: (progress: SdkMigrationProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkMigrationProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkMigrateProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkMigrateProgress, listener)
    }
  },
  /** bootstrap 进度订阅（许可确认通过、组件开始下载后才首个事件——忙碌态由此驱动） */
  onSdkProgress: (callback: (progress: SdkProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkProgress, listener)
    }
  },
  onProgress: (callback: (progress: SdkProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkProgress, listener)
    }
  },
  /** 内置设备画像目录 */
  profiles: (): Promise<DeviceProfile[]> => ipcRenderer.invoke(IPC_CHANNELS.sdkProfiles),
  /** 镜像清单（六源 manifest + 本地核验合并；60s 缓存；部分源失败带警告） */
  images: (root?: string): Promise<ImageCatalogResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkImages, root),
  /** 未装镜像下载（单下载互斥；进度经 onImageProgress 推送） */
  downloadImage: (packageName: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkDownloadImage, { packageName }),
  /** 取消进行中的下载（幂等；resolve = main 已收尾清理） */
  cancelDownloadImage: (packageName: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkCancelDownloadImage, { packageName }),
  /** 卸载已装镜像（设备引用/下载互斥守卫在 main；错误文案含原因） */
  uninstallImage: (packageName: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkUninstallImage, { packageName }),
  /** 向导设置能力（画像×镜像×emulator 版本；defaults/枚举/边界/禁用原因） */
  wizardCapabilities: (profileId: string, imagePackageName: string): Promise<WizardCapabilities> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkWizardCapabilities, { profileId, imagePackageName }),
  /** 卸载终态订阅（完成/失败广播；重开向导由此解除恢复的卸载状态） */
  onUninstallState: (callback: (state: SdkUninstallState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SdkUninstallState): void => {
      callback(state)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkUninstallState, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkUninstallState, listener)
    }
  },
  onImageProgress: (callback: (progress: SdkImageProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkImageProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkImageProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkImageProgress, listener)
    }
  },
  /** 机型皮肤清单（SDK 已装 + 导入/下载库） */
  deviceSkinPresentation: (deviceId: string): Promise<DeviceSkinPresentation | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkDeviceSkinPresentation, { deviceId }),
  cameraAccess: (request: boolean): Promise<CameraSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkCameraAccess, { request }),
  cameraSettings: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.sdkCameraSettings),
  deviceSkins: (): Promise<DeviceSkinSummary[]> => ipcRenderer.invoke(IPC_CHANNELS.sdkDeviceSkins),
  /** 原生选择器导入皮肤压缩包（向导窗专用通道）；null = 用户取消 */
  chooseDeviceSkin: (): Promise<DeviceSkinSummary | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.wizardChooseDeviceSkin),
  /** 受控下载官方皮肤（向导窗专用通道；进度经 onSkinProgress 推送）；null = 同意框取消 */
  downloadDeviceSkin: (skinName: string): Promise<DeviceSkinSummary | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkDownloadDeviceSkin, { skinName }),
  onSkinProgress: (callback: (progress: SdkSkinProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkSkinProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkSkinProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkSkinProgress, listener)
    }
  }
}
