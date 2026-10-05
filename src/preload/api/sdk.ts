import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  DeviceProfile,
  ImageCatalogResult,
  SdkImageProgress,
  SdkProgress,
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
  /** 向导设置能力（画像×镜像×emulator 版本；defaults/枚举/边界/禁用原因） */
  wizardCapabilities: (profileId: string, imagePackageName: string): Promise<WizardCapabilities> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkWizardCapabilities, { profileId, imagePackageName }),
  onImageProgress: (callback: (progress: SdkImageProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SdkImageProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.sdkImageProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.sdkImageProgress, listener)
    }
  }
}
