import type { ImageCatalogResult } from '@shared/types'
import type { PackageOp } from './packageOps'

/**
 * 卸载守卫链（plan 2026-10-06-image-uninstall 设计 2；review 2026-10-06 收紧
 * 互斥为双向）：顺序固定、逐条中文拒绝。抽成纯函数供 IPC 层调用与单测——
 * 渲染层不拼装文案，直接展示 main 错误。
 */

export interface UninstallGuards {
  /** 当前镜像目录（可信清单 + 本地核验状态） */
  catalog: Pick<ImageCatalogResult, 'images'>
  /** 进行中的包操作（下载/卸载共用互斥，双向拒绝） */
  activeOp: PackageOp | null
  /** 引用该包的设备名（含创建中事务） */
  referencing: string[]
}

export const assertUninstallable = (packageName: string, guards: UninstallGuards): void => {
  const entry = guards.catalog.images.find((image) => image.packageName === packageName)
  if (entry === undefined) {
    throw new Error(`包 ${packageName} 不在可信镜像目录中`)
  }
  // 半安装同样拒绝：先修复才有删除资格，避免「删一半」之谜
  if (!entry.installed) {
    throw new Error('镜像未完整安装，无需卸载')
  }
  if (guards.activeOp !== null) {
    if (guards.activeOp.kind === 'download') {
      throw new Error(`已有镜像在下载（${guards.activeOp.packageName}），下载完成后再卸载`)
    }
    throw new Error(`正在卸载镜像（${guards.activeOp.packageName}），请等待完成`)
  }
  if (guards.referencing.length > 0) {
    throw new Error(`镜像正被设备引用（${guards.referencing.join('、')}），删除这些设备后才可卸载`)
  }
}
