import { app } from 'electron'
import { join } from 'node:path'
import { onSdkSourceChanged } from './sdkSourceSwitch'
import { registerSdkSourceIpc } from './sdkIpcSource'
import { registerSdkCatalogIpc } from './sdkIpcCatalog'
import { registerSdkSkinsIpc } from './sdkIpcSkins'
import { registerSdkImagesIpc } from './sdkIpcImages'
import type { SdkIpcDeps } from './sdkIpcShared'

/** 应用自有 AVD 根（ANDROID_AVD_HOME 语义） */
export const defaultAvdHome = (): string => join(app.getPath('userData'), 'avd-home')

// 来源变更监听（sdkSourceSwitch 定义）：ipc/index.ts 登记点接线 devices 重查
export { onSdkSourceChanged }

export type { SdkIpcDeps } from './sdkIpcShared'

/** SDK 域 IPC 装配：来源/画像清单/皮肤/镜像四组注册 + 可选依赖注入 */
export function registerSdkIpc(deps: SdkIpcDeps = {}): void {
  registerSdkSourceIpc(deps)
  registerSdkCatalogIpc()
  registerSdkSkinsIpc(deps)
  registerSdkImagesIpc(deps)
}
