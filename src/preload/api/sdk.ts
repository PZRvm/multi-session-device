import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  DeviceProfile,
  ImageEntry,
  SdkImageProgress,
  SdkProgress,
  SdkSnapshot
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
  /** 镜像清单（manifest + 已装标记，60s 缓存） */
  images: (root?: string): Promise<ImageEntry[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkImages, root),
  /** 未装镜像下载（单下载互斥；进度经 onImageProgress 推送） */
  downloadImage: (packageName: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.sdkDownloadImage, { packageName }),
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
