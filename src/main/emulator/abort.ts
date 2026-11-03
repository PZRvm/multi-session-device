/** 中止本次等待；底层只读操作的迟到结果仍被观察，但不再推进调用链。 */
export const awaitWithAbort = <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => reject(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(() => {
        signal?.throwIfAborted()
        return operation()
      })
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener('abort', onAbort))
  })
/** 正常结束也解除 abort 监听，启动轮询不会在同一 signal 上累积监听器。 */
export const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
