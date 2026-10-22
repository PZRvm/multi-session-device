import { cp, rename as fsRename, rm } from 'node:fs/promises'

/**
 * rename 容错工厂（plan 2026-10-22-windows-file-resilience 设计 1）。
 * Windows 上杀软/索引器短暂打开文件句柄会让 rename 直接报 EPERM/EACCES/EBUSY
 * （mac 不存在此形态）——重试窗口对齐 graceful-fs（约 1s）；EXDEV 是跨卷移动，
 * 回退 cp+rm（fs-extra 思路；既有调用点均同根同卷构造，EXDEV 只在 st_dev 误判
 * 等异常场景出现，兜底不保证原子，失败由各调用点既有回滚路径收口）。
 * 非 win32 恒为裸 fs.rename——mac 零变化是构造性保证，不靠「重试恰好不触发」。
 */

/** win32 下可重试的锁错误码（graceful-fs 的 Windows 集合，EBUSY 为杀软句柄常见形态） */
export const RETRYABLE_CODES = ['EPERM', 'EACCES', 'EBUSY'] as const
export const RETRY_INTERVAL_MS = 100
export const RETRY_MAX = 10

export interface ResilientRenameDeps {
  renameFn?: (from: string, to: string) => Promise<void>
  copyDir?: (from: string, to: string) => Promise<void>
  removePath?: (path: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
}

export type ResilientRename = (from: string, to: string) => Promise<void>

const isRetryableCode = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code !== undefined && (RETRYABLE_CODES as readonly string[]).includes(code)
}

export const makeResilientRename =
  (platform: NodeJS.Platform, deps: ResilientRenameDeps = {}): ResilientRename =>
  async (from, to) => {
    const renameFn = deps.renameFn ?? fsRename
    if (platform !== 'win32') return renameFn(from, to)

    const copyDir =
      deps.copyDir ?? ((src: string, dest: string) => cp(src, dest, { recursive: true, force: true }))
    const removePath =
      deps.removePath ?? ((path: string) => rm(path, { recursive: true, force: true }))
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

    for (let attempt = 0; ; attempt += 1) {
      try {
        await renameFn(from, to)
        return
      } catch (error) {
        if (isRetryableCode(error) && attempt < RETRY_MAX) {
          await sleep(RETRY_INTERVAL_MS)
          continue
        }
        if ((error as NodeJS.ErrnoException)?.code === 'EXDEV') {
          await copyDir(from, to)
          await removePath(from)
          return
        }
        throw error
      }
    }
  }
