import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeRecordings, useRecordingStore } from '../recordingStore'
import type { RecordingSnapshot } from '@shared/recording'
const snapshot = (revision: number): RecordingSnapshot => ({ revision, tasks: [], limit: 2 })
beforeEach(() => {
  useRecordingStore.setState({ snapshot: snapshot(-1), pending: [], errors: [] })
})
afterEach(() => {
  delete (window as { api?: unknown }).api
})
describe('recording mirror', () => {
  it('installs the listener first and ignores a stale initial response', async () => {
    let listener!: (value: RecordingSnapshot) => void
    let resolve!: (value: RecordingSnapshot) => void
    const unsubscribe = vi.fn()
    ;(window as { api?: unknown }).api = {
      recording: {
        onChanged: (callback: typeof listener) => {
          listener = callback
          return unsubscribe
        },
        get: () =>
          new Promise((accept) => {
            resolve = accept
          })
      }
    }
    const stop = subscribeRecordings()
    listener(snapshot(8))
    resolve(snapshot(3))
    await new Promise((accept) => setTimeout(accept, 0))
    expect(useRecordingStore.getState().snapshot.revision).toBe(8)
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('deduplicates in-flight commands and exposes a rejected invocation', async () => {
    let reject!: (error: Error) => void
    const start = vi.fn(
      () =>
        new Promise((_, failed) => {
          reject = failed
        })
    )
    ;(window as { api?: unknown }).api = { recording: { start } }
    const first = useRecordingStore.getState().start('device')
    await useRecordingStore.getState().start('device')
    expect(start).toHaveBeenCalledTimes(1)
    reject(new Error('Device not ready'))
    await first
    expect(useRecordingStore.getState().errors).toEqual(['Device not ready'])
    expect(useRecordingStore.getState().pending).toEqual([])
  })

  it('queues concurrent command failures instead of overwriting the first', async () => {
    const rejectors: Array<(error: Error) => void> = []
    const command = vi.fn(
      () =>
        new Promise<RecordingSnapshot>((_, reject) => {
          rejectors.push(reject)
        })
    )
    ;(window as { api?: unknown }).api = { recording: { command } }
    const first = useRecordingStore.getState().command('task-a', 'stop')
    const second = useRecordingStore.getState().command('task-b', 'stop')
    rejectors[0](new Error('A failed'))
    rejectors[1](new Error('B failed'))
    await Promise.all([first, second])
    expect(useRecordingStore.getState().errors).toEqual(['A failed', 'B failed'])
    useRecordingStore.getState().dismissError()
    expect(useRecordingStore.getState().errors).toEqual(['B failed'])
    expect(useRecordingStore.getState().pending).toEqual([])
  })
})
