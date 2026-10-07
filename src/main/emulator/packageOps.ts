/**
 * SDK 包操作互斥（review 2026-10-06 P1/P2）：下载与卸载共用一把锁——同一
 * SDK 根上不允许两个 sdkmanager 写进程并发；设备创建事务按包名检查本状态，
 * 关闭「引用守卫通过后、卸载执行中」窗口内建出引用即将被删镜像的设备（TOCTOU）。
 */

export interface PackageOp {
  kind: 'download' | 'uninstall'
  packageName: string
}

let active: PackageOp | null = null

// 创建意向（review P2-2 残窗收口）：createDevice 的秒级 await 间隙（本地扫描、
// Java 画像重查）里，同包的下载/卸载不应启动——设备临时行要到最后才入列，
// 引用查询在此期间看不到它。意向在创建事务全程持有（finally 释放），
// beginPackageOp 与卸载守卫（assertUninstallable）都读本探针。
const creatingPackages = new Set<string>()

/** 当前进行中的包操作；null = 空闲（创建事务等外部域只读此探针） */
export const activePackageOp = (): PackageOp | null => active

/** 开始一次包操作；已有任一操作进行中、或该包正被创建事务引用时以中文错误拒绝 */
export const beginPackageOp = (op: Exclude<PackageOp, null>): void => {
  if (isPackageCreating(op.packageName)) {
    throw new Error(`镜像正在被新建设备引用（${op.packageName}），创建完成后再操作`)
  }
  if (active !== null) {
    throw new Error(
      active.kind === 'download'
        ? `已有镜像在下载（${active.packageName}），请等待完成`
        : `正在卸载镜像（${active.packageName}），请等待完成`
    )
  }
  active = op
}

/** 操作收尾（成功失败都调）；配对 beginPackageOp */
export const endPackageOp = (): void => {
  active = null
}

/** 登记创建意向（创建事务入口调，全程持有）；配对 endPackageCreation */
export const beginPackageCreation = (packageName: string): void => {
  creatingPackages.add(packageName)
}

/** 释放创建意向（事务 finally 调——成功失败都释放） */
export const endPackageCreation = (packageName: string): void => {
  creatingPackages.delete(packageName)
}

/** 该包是否有进行中的创建事务（下载/卸载守卫用） */
export const isPackageCreating = (packageName: string): boolean => creatingPackages.has(packageName)
