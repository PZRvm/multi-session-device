import type { ImageCatalogResult } from '@shared/types'

/**
 * 卸载守卫链（plan 2026-10-06-image-uninstall 设计 2）：顺序固定、逐条中文
 * 拒绝。抽成纯函数供 IPC 层调用与单测——渲染层不拼装文案，直接展示 main 错误。
 */

export interface UninstallGuards {
  /** 当前镜像目录（可信清单 + 本地核验状态） */
  catalog: Pick<ImageCatalogResult, 'images'>
  /** 进行中的下载任务（互斥） */
  downloading: { packageName: string } | null
  /** 引用该包的设备名（含创建中事务） */
  referencing: string[]
}

export const assertUninstallable = (
  packageName: string,
  guards: UninstallGuards
): { sizeBytes: number | null } => {
  const entry = guards.catalog.images.find((image) => image.packageName === packageName)
  if (entry === undefined) {
    throw new Error(`包 ${packageName} 不在可信镜像目录中`)
  }
  // 半安装同样拒绝：先修复才有删除资格，避免「删一半」之谜
  if (!entry.installed) {
    throw new Error('镜像未完整安装，无需卸载')
  }
  if (guards.downloading !== null) {
    throw new Error(`已有镜像在下载（${guards.downloading.packageName}），下载完成后再卸载`)
  }
  if (guards.referencing.length > 0) {
    throw new Error(`镜像正被设备引用（${guards.referencing.join('、')}），删除这些设备后才可卸载`)
  }
  return { sizeBytes: entry.sizeBytes }
}
