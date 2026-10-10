import { ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ApkInstallResult } from '@shared/types'

export const installApi = {
  /** 拖放文件 → 绝对路径。Electron 39 已移除 File.path，webUtils 只能在 preload 调用
   *  （plan 2026-10-10-drag-apk-install 风险表）；File 对象经 contextBridge 传入受支持 */
  resolveDropPaths: (files: File[]): string[] => files.map((file) => webUtils.getPathForFile(file)),
  /** 拖拽 APK 安装到 running 设备（main 校验 running/serial；每设备串行） */
  install: (deviceId: string, filePath: string): Promise<ApkInstallResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.apkInstall, { deviceId, filePath })
}
