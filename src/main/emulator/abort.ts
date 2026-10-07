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
