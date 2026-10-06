import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  DeviceProfile,
  DeviceSkinSummary,
  ImageCatalogResult,
  SdkImageProgress,
  SdkUninstallState,
  SdkProgress,
  SdkSkinProgress,
  SdkSnapshot,
  WizardCapabilities
} from '@shared/types'

/** SDK 域白名单：状态探测 + bootstrap（进度经 onProgress 推送） */
export const sdkApi = {
  status: (root?: string): Promise<SdkSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.sdkStatus, root),
  bootstrap: (root?: string): Promise<SdkSnapshot> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkBootstrap, root),
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
  deviceSkins: (): Promise<DeviceSkinSummary[]> => ipcRenderer.invoke(IPC_CHANNELS.sdkDeviceSkins),
  /** 原生选择器导入皮肤压缩包（向导窗专用通道） */
  chooseDeviceSkin: (): Promise<DeviceSkinSummary> =>
    ipcRenderer.invoke(IPC_CHANNELS.wizardChooseDeviceSkin),
  /** 受控下载官方皮肤（向导窗专用通道；进度经 onSkinProgress 推送） */
  downloadDeviceSkin: (skinName: string): Promise<DeviceSkinSummary> =>
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
