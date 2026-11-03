// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessorFrame } from '@shared/recording'
import { IPC_CHANNELS as C } from '@shared/ipc-channels'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  windows: [] as unknown[]
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn)
  },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      setWindowOpenHandler: vi.fn()
    })
    constructor() {
      super()
      mocks.windows.push(this)
    }
    loadFile = async (): Promise<void> => undefined
    isDestroyed = (): boolean => false
    destroy = (): void => {
      this.emit('closed')
    }
  }
}))
let processor: typeof import('../processor')
beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear()
  mocks.windows = []
  processor = await import('../processor')
})
afterEach(() => {
  processor.cancelProcessor()
  vi.useRealTimers()
})
async function* frames(): AsyncGenerator<ProcessorFrame> {
  yield {
    data: Uint8Array.of(1),
    keyframe: true,
    codec: 'avc1.640034',
    boundary: true,
    timestamp: 0,
    duration: 100000
  }
}
const event = (): { sender: { mainFrame: unknown }; senderFrame: unknown } => {
  const window = mocks.windows.at(-1) as { webContents: { mainFrame: unknown } }
  return { sender: window.webContents, senderFrame: window.webContents.mainFrame }
}
const invoke = (channel: string, evt: unknown, raw?: unknown): unknown =>
  mocks.handlers.get(channel)!(evt, raw)
describe('private recording processor IPC', () => {
  it('rejects another window, subframes and forged tokens before media writes', async () => {
    const push = vi.fn(async () => undefined)
    const done = processor.processVideo(2400, 2400, frames(), push, async () => true)
    void done.catch(() => undefined)
    const evt = event()
    const auth = invoke(C.recordingProcessorReady, evt) as Record<string, unknown>
    expect(auth).not.toHaveProperty('path')
    expect(() => invoke(C.recordingProcessorReady, { ...evt, sender: {} })).toThrow('Unauthorized')
    expect(() => invoke(C.recordingProcessorReady, { ...evt, senderFrame: {} })).toThrow(
      'Unauthorized'
    )
    await expect(
      invoke(C.recordingProcessorPush, evt, { ...auth, token: 'fake', seq: 0 })
    ).rejects.toThrow('Unauthorized')
    expect(push).not.toHaveBeenCalled()
    processor.cancelProcessor()
    await expect(done).rejects.toThrow('cancelled')
  })
  it('requires every input batch to be consumed before completion', async () => {
    const done = processor.processVideo(2400, 2400, frames(), vi.fn(), async () => true)
    void done.catch(() => undefined)
    const evt = event(),
      auth = invoke(C.recordingProcessorReady, evt)
    expect(() => invoke(C.recordingProcessorComplete, evt, auth)).toThrow('still writing')
    await expect(done).rejects.toThrow('still writing')
  })
  it('rejects reordered input requests', async () => {
    const done = processor.processVideo(2400, 2400, frames(), vi.fn(), async () => true)
    void done.catch(() => undefined)
    const evt = event(),
      auth = invoke(C.recordingProcessorReady, evt) as Record<string, unknown>
    await invoke(C.recordingProcessorSize, evt, { ...auth, width: 2400, height: 2400 })
    await expect(invoke(C.recordingProcessorPull, evt, { ...auth, seq: 1 })).rejects.toThrow(
      'sequence'
    )
    await expect(done).rejects.toThrow('sequence')
  })
  it('delivers bounded frames and allows authenticated finalization after EOF', async () => {
    const done = processor.processVideo(2400, 2400, frames(), vi.fn(), async () => true)
    const evt = event(),
      auth = invoke(C.recordingProcessorReady, evt) as Record<string, unknown>
    expect(
      await invoke(C.recordingProcessorSize, evt, { ...auth, width: 2400, height: 2400 })
    ).toBe(true)
    expect(await invoke(C.recordingProcessorPull, evt, { ...auth, seq: 0 })).toHaveLength(1)
    invoke(C.recordingProcessorComplete, evt, auth)
    await done
  })
})

describe('processor stale native reply', () => {
  it('cannot install an old watchdog that rejects the next job', async () => {
    vi.useFakeTimers()
    let resolveSize!: (value: boolean) => void
    const old = processor.processVideo(
      2400,
      2400,
      frames(),
      vi.fn(),
      () =>
        new Promise((resolve) => {
          resolveSize = resolve
        })
    )
    void old.catch(() => undefined)
    const oldEvent = event(),
      oldAuth = invoke(C.recordingProcessorReady, oldEvent) as Record<string, unknown>
    const choosing = invoke(C.recordingProcessorSize, oldEvent, {
      ...oldAuth,
      width: 1200,
      height: 1200
    })
    processor.cancelProcessor()
    await expect(old).rejects.toThrow('cancelled')
    const next = processor.processVideo(2400, 2400, frames(), vi.fn(), async () => true)
    let rejected = false
    void next.catch(() => {
      rejected = true
    })
    const evt = event(),
      auth = invoke(C.recordingProcessorReady, evt) as Record<string, unknown>
    await invoke(C.recordingProcessorSize, evt, { ...auth, width: 2400, height: 2400 })
    await vi.advanceTimersByTimeAsync(5000)
    resolveSize(true)
    await choosing
    await vi.advanceTimersByTimeAsync(25000)
    await invoke(C.recordingProcessorPull, evt, { ...auth, seq: 0 })
    await vi.advanceTimersByTimeAsync(35000)
    expect(rejected).toBe(false)
    invoke(C.recordingProcessorComplete, evt, auth)
    await next
  })
})
