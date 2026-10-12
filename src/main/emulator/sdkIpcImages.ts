import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SdkImageProgress, SdkUninstallState } from '@shared/types'
import { uninstallSdkManagerPackage } from './sdk'
import { splitPackageName, listImagesWithState } from './catalog'
import { downloadImagePackage } from './downloader'
import { assertUninstallable } from './uninstall'
import { activePackageOp, beginPackageOp, endPackageOp, isPackageCreating } from './packageOps'
import {
  activeDownload,
  assertSdkWritable,
  clearActiveDownload,
  imagesFor,
  invalidateImagesCache,
  pushToAllWindows,
  requireSdkReady,
  requireWizardSender,
  resolveRoot,
  setActiveDownload,
  type SdkIpcDeps
} from './sdkIpcShared'
import { msg } from '../locale'

/** 镜像卸载/下载/取消 handler（卸载守卫链 → 官方操作 → 落盘复核 → 缓存失效） */
export function registerSdkImagesIpc(deps: SdkIpcDeps): void {
  // 卸载已装镜像（plan 2026-10-06-image-uninstall）：守卫链（uninstall.ts 纯函数，
  // 顺序固定）→ 官方 --uninstall → 落盘复核 → 缓存失效
  ipcMain.handle(IPC_CHANNELS.sdkUninstallImage, async (_event, raw: unknown): Promise<void> => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).packageName !== 'string'
    ) {
      throw new Error(`${IPC_CHANNELS.sdkUninstallImage}${msg('invalidPayload')}`)
    }
    assertSdkWritable(IPC_CHANNELS.sdkUninstallImage)
    const packageName = (raw as Record<string, unknown>).packageName as string
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    const catalog = imagesFor(root) ?? (await listImagesWithState(root))
    assertUninstallable(packageName, {
      catalog,
      activeOp: activePackageOp(),
      creating: isPackageCreating(packageName),
      referencing: deps.referencingDeviceNames?.(packageName) ?? []
    })
    beginPackageOp({ kind: 'uninstall', packageName })
    try {
      try {
        await uninstallSdkManagerPackage(root, packageName)
      } catch (error) {
        // 卸载进程失败：终态广播（发起窗口可能已关——错误只 throw 给 invoke 方
        // 对它无意义），文案标注是卸载步骤
        pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
          packageName,
          error: msg('uninstallImageFailed', {
            message: error instanceof Error ? error.message : String(error)
          })
        } satisfies SdkUninstallState)
        throw error
      }
      // 落盘复核：直接探测包目录存在性（scanLocalImages 只认带 package.xml 的
      // 目录——非标准残留会被它漏掉，review 2026-10-06 P2）
      const parts = splitPackageName(packageName)
      if (parts !== null) {
        const dir = join(root, 'system-images', parts.platformSegment, parts.tagSegment, parts.abi)
        const dirExists = await stat(dir).then(
          () => true,
          () => false
        )
        if (dirExists) {
          // 复核失败就地广播（重开窗口只依赖广播，不看 invoke 拒绝）
          pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
            packageName,
            error: msg('uninstallResidualDir', { dir })
          } satisfies SdkUninstallState)
          throw new Error(msg('uninstallResidualDir', { dir }))
        }
      }
      invalidateImagesCache()
      // 完成广播必须在复核通过 + 缓存失效之后：广播触发 renderer 重拉清单，
      // 先广播会命中 60s 旧缓存闪回「已安装」（二轮 review P1）
      pushToAllWindows(IPC_CHANNELS.sdkUninstallState, {
        packageName
      } satisfies SdkUninstallState)
    } finally {
      endPackageOp()
    }
  })

  ipcMain.handle(IPC_CHANNELS.sdkDownloadImage, async (_event, raw: unknown): Promise<void> => {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).packageName !== 'string'
    ) {
      throw new Error(`${IPC_CHANNELS.sdkDownloadImage}${msg('invalidPayload')}`)
    }
    assertSdkWritable(IPC_CHANNELS.sdkDownloadImage)
    const packageName = (raw as Record<string, unknown>).packageName as string
    // 守卫从固定正则升级为可信目录核验：包必须出现在当前 manifest/本地扫描结果里
    const root = resolveRoot(undefined)
    await requireSdkReady(root)
    const catalog = imagesFor(root) ?? (await listImagesWithState(root))
    const entry = catalog.images.find((image) => image.packageName === packageName)
    if (entry === undefined) {
      throw new Error(
        `${IPC_CHANNELS.sdkDownloadImage}: ${msg('packageNotTrusted', { packageName })}`
      )
    }
    if (entry.abi !== 'arm64-v8a') {
      throw new Error(
        `${IPC_CHANNELS.sdkDownloadImage}: ${msg('crossArchDownloadUnsupported', { abi: entry.abi })}`
      )
    }
    // 统一包操作互斥（packageOps）：拒绝进行中的下载/卸载（文案含包名）；
    // 下载侧的取消链路（abort/done）保留在 downloading 对象上
    beginPackageOp({ kind: 'download', packageName })
    const abort = new AbortController()
    // done 是显式收尾信号：在 finally 里、互斥释放之后 resolve——取消 handler
    // await 它即得到「收尾完成且可立即重下」的硬保证，不依赖微任务顺序（review P2-3）
    // executor 同步执行，finally 里必已赋值——! 是给 TS definiteness 分析的明确标注
    let settleDone!: () => void
    const done = new Promise<void>((resolve) => {
      settleDone = resolve
    })
    setActiveDownload({ packageName, percent: 0, abort, done })
    try {
      // 下载会改变已装状态——失效清单缓存
      invalidateImagesCache()
      // 直连下载（plan 2026-10-06-download-progress-zero）：官方 CLI 无进度流，
      // sdkmanager 执行体退役为 bootstrap 等场景；此处用 manifest zip 流式下载。
      const outcome = await downloadImagePackage(
        root,
        {
          packageName,
          zipUrl: entry.zipUrl,
          zipSha1: entry.zipSha1,
          sizeBytes: entry.sizeBytes,
          displayName: entry.displayName,
          apiLevelText:
            entry.api.major === null
              ? entry.api.platformSegment.replace(/^android-/, '')
              : entry.api.minor !== null
                ? `${entry.api.major}.${entry.api.minor}`
                : `${entry.api.major}`,
          extensionLevel: entry.api.extensionLevel,
          tagIds: entry.tagIds,
          abi: entry.abi,
          revision: entry.revision
        },
        (percent) => {
          const task = activeDownload()
          if (task !== null) task.percent = percent
          const progress: SdkImageProgress = {
            packageName,
            percent,
            message: `下载 ${packageName}`
          }
          pushToAllWindows(IPC_CHANNELS.sdkImageProgress, progress)
        },
        {},
        abort.signal
      )
      if (outcome === 'canceled') {
        // 取消不是失败：广播给在听窗口（重开的向导清恢复态），无错误横幅
        pushToAllWindows(IPC_CHANNELS.sdkImageProgress, {
          packageName,
          percent: 0,
          message: `已取消 ${packageName}`,
          canceled: true
        } satisfies SdkImageProgress)
        return
      }
    } catch (error) {
      // 发起下载的向导窗可能已关闭（invoke 拒绝对它无意义）——失败广播给
      // 在听的窗口，重开的向导据此显示错误与重试入口（plan 设计 9）
      const message = error instanceof Error ? error.message : String(error)
      pushToAllWindows(IPC_CHANNELS.sdkImageProgress, {
        packageName,
        percent: 0,
        message: `下载失败 ${packageName}`,
        error: message
      } satisfies SdkImageProgress)
      throw error
    } finally {
      clearActiveDownload()
      endPackageOp()
      settleDone()
    }
  })

  // 显式取消进行中的下载（plan 2026-10-06-download-cancel）：幂等——无任务或
  // 包名不匹配直接成功（迟到/重复点击不报错）；resolve 时点 = 收尾完成（临时
  // 物已清理、互斥已释放），renderer 以此为准本地清状态，广播服务重开窗
  ipcMain.handle(
    IPC_CHANNELS.sdkCancelDownloadImage,
    async (event, raw: unknown): Promise<void> => {
      requireWizardSender(IPC_CHANNELS.sdkCancelDownloadImage, event)
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`${IPC_CHANNELS.sdkCancelDownloadImage}${msg('invalidPayload')}`)
      }
      const packageName = (raw as Record<string, unknown>).packageName
      if (typeof packageName !== 'string') {
        throw new Error(`${IPC_CHANNELS.sdkCancelDownloadImage}: ${msg('invalidPackageName')}`)
      }
      const task = activeDownload()
      if (task === null || task.packageName !== packageName) return
      task.abort.abort()
      // 收尾竞态兜底：下载若恰好以失败告终（与取消同时），等待不吞它的错误路径
      await task.done.catch(() => undefined)
    }
  )
}
