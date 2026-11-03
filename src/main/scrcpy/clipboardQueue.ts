import type { ClipboardSource } from './clipboardSync'
import { CLIPBOARD_ACK_TIMEOUT_MS } from './control'

export interface ClipboardJob {
  text: string
  source: ClipboardSource
  valid: () => boolean
}
interface Pending extends ClipboardJob {
  resolve: () => void
  reject: (error: Error) => void
}
export interface ClipboardQueue {
  enqueue: (job: ClipboardJob) => Promise<void>
  dispose: () => void
}

/** 外部 2s 派发降级与实际 writer 生命周期分离，避免无 ACK 时无限积压。 */
export function createClipboardQueue(deps: {
  write: (job: ClipboardJob) => Promise<void>
  onFailure: (error: Error) => void
  error: (kind: 'closed' | 'stale' | 'backlog' | 'timeout') => Error
}): ClipboardQueue {
  let closed = false
  let active: Pending | null = null
  let pendingSync: Pending | null = null
  const waiting: Pending[] = []
  let grace: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const clearTimers = (): void => {
    clearTimeout(grace)
    clearTimeout(deadline)
  }
  const dispose = (): void => {
    if (closed) return
    closed = true
    clearTimers()
    active?.reject(deps.error('closed'))
    active = null
    for (const item of waiting.splice(0)) item.reject(deps.error('closed'))
    pendingSync?.reject(deps.error('closed'))
    pendingSync = null
  }
  const fail = (error: Error): void => {
    active?.reject(error)
    dispose()
    deps.onFailure(error)
  }
  const pump = (): void => {
    if (closed || active) return
    let item: Pending | undefined
    while ((item = waiting.shift() ?? pendingSync ?? undefined)) {
      if (item === pendingSync) pendingSync = null
      if (!item.valid()) {
        item.reject(deps.error('stale'))
        continue
      }
      const job = item
      active = job
      // 调用方可以收口，但实际 writer 仍占据单飞位置直到 settle/5s 故障。
      grace = setTimeout(job.resolve, CLIPBOARD_ACK_TIMEOUT_MS)
      deadline = setTimeout(() => fail(deps.error('timeout')), 5_000)
      try {
        void deps.write(job).then(
          () => {
            if (active !== job || closed) return
            clearTimers()
            job.resolve()
            active = null
            pump()
          },
          (error: unknown) => {
            if (active !== job || closed) return
            fail(error instanceof Error ? error : deps.error('closed'))
          }
        )
      } catch (error) {
        fail(error instanceof Error ? error : deps.error('closed'))
      }
      return
    }
  }
  return {
    enqueue: (job) =>
      new Promise<void>((resolve, reject) => {
        if (closed) {
          reject(deps.error('closed'))
          return
        }
        const item = { ...job, resolve, reject }
        if (job.source === 'sync') {
          pendingSync?.resolve() // 最新值替代尚未发出的同步；不合并显式输入。
          pendingSync = item
        } else {
          if (waiting.length >= 16) {
            reject(deps.error('backlog'))
            return
          }
          waiting.push(item)
        }
        pump()
      }),
    dispose
  }
}
