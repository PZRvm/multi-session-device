// @vitest-environment node
// 2026-11-10 无线健壮性回归：建流失败清理（A）、建立期自动重试（C）、熄屏唤醒（B）。
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import { ScrcpyInstanceId, type ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenStateMessage } from '@shared/types'
import { createScrcpyManager } from '../index'
import { establishTransport } from '../transport'
import type { Transport, TransportDeps } from '../transport'
import { SafeControlMessageWriter } from '../controlWriter'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
  handle: vi.fn(),
  windowRef: { current: null as BrowserWindow | null }
}))

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: { handle: mocks.handle },
  BrowserWindow: {}
}))
vi.mock('../../emulator/adb', () => ({ scrubAdbEnv: (env: NodeJS.ProcessEnv) => env }))

const WIRELESS_SERIAL = '192.168.31.162:5555'
const USB_SERIAL = 'DSLDU123456'
const SERVER_JAR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../resources/scrcpy-server-v3.3.3'
)

class FakeProc extends EventEmitter {
  exitCode: number | null = null
  kill = vi.fn(() => true)
}

class FakeSocket extends EventEmitter {
  written: Buffer[] = []
  destroy = vi.fn()
  pause = vi.fn()
  resume = vi.fn()
  write = (chunk: Buffer, cb?: (error?: Error) => void): boolean => {
    this.written.push(chunk)
    cb?.()
    return true
  }
  end = (cb?: () => void): void => {
    cb?.()
  }
}

// ---- Fix A：establish 失败清理 ----

const baseDeps = (overrides: Partial<TransportDeps> = {}): TransportDeps => {
  const serverProc = new FakeProc()
  const run = vi.fn(async (_path: string, args: string[]) => {
    if (args[2] === 'forward' && args[3] === 'tcp:0') {
      return { code: 0, stdout: '12345\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  })
  return {
    serial: WIRELESS_SERIAL,
    adbPath: '/adb',
    serverPath: SERVER_JAR,
    run: run as unknown as TransportDeps['run'],
    spawn: vi.fn(() => serverProc as unknown as Transport['serverProc']),
    connect: vi.fn(async () => new FakeSocket() as unknown as Transport['videoSocket']),
    toolEnv: () => ({}),
    signal: new AbortController().signal,
    ...overrides
  }
}

describe('establishTransport 失败清理（无线泄漏回归）', () => {
  it('forward 失败：kill serverProc，且不对未建立的端口做 forward --remove', async () => {
    const deps = baseDeps({
      run: vi.fn(async (_path: string, args: string[]) =>
        args[2] === 'forward'
          ? { code: 1, stdout: '', stderr: 'cannot bind' }
          : { code: 0, stdout: '', stderr: '' }
      )
    })
    await expect(establishTransport(deps)).rejects.toThrow(/adb forward 失败/)
    const spawn = deps.spawn as ReturnType<typeof vi.fn>
    const proc = spawn.mock.results[0]?.value as unknown as FakeProc
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    const run = deps.run as ReturnType<typeof vi.fn>
    expect(run.mock.calls.some(([, args]) => args[3] === '--remove')).toBe(false)
  })

  it('connect 循环中 abort：kill serverProc + 移除已建立的 forward', async () => {
    let releaseConnect: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })
    const deps = baseDeps({
      signal: new AbortController().signal,
      connect: vi.fn(async () => {
        await gate
        return new FakeSocket() as unknown as Transport['videoSocket']
      })
    })
    const controller = new AbortController()
    deps.signal = controller.signal
    const pending = establishTransport(deps)
    await vi.waitFor(() => expect(deps.connect).toHaveBeenCalled())
    releaseConnect!()
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    const spawn = deps.spawn as ReturnType<typeof vi.fn>
    const proc = spawn.mock.results[0]?.value as unknown as FakeProc
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
    const run = deps.run as ReturnType<typeof vi.fn>
    expect(
      run.mock.calls.some(([, args]) => args[3] === '--remove' && args[4] === 'tcp:12345')
    ).toBe(true)
  })
})

// ---- Fix C：建立期自动重试 ----

interface Harness {
  manager: ReturnType<typeof createScrcpyManager>
  establish: ReturnType<typeof vi.fn>
  adbRun: ReturnType<typeof vi.fn>
}

const importManager = async (
  establishImpl: (deps: TransportDeps) => Promise<Transport>
): Promise<Harness> => {
  const { createScrcpyManager } = await import('../index')
  const establish = vi.fn(async (deps: TransportDeps): Promise<Transport> => establishImpl(deps))
  const adbRun = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
  const manager = createScrcpyManager({
    adbPath: () => '/adb',
    toolEnv: () => ({}),
    getMainWindow: () => mocks.windowRef.current,
    isMainSender: () => true,
    runAdb: adbRun,
    establish: establish as unknown as (typeof import('../transport'))['establishTransport']
  })
  manager.registerIpc()
  return { manager, establish, adbRun }
}

const makeTransport = (): Transport => {
  let pushController: ReadableStreamDefaultController<ScrcpyMediaStreamPacket> | null = null
  const mediaStream = new ReadableStream<ScrcpyMediaStreamPacket>({
    start: (controller) => {
      pushController = controller
    }
  })
  const options = new AdbScrcpyOptionsLatest<true>({
    scid: new ScrcpyInstanceId(1),
    audio: false,
    tunnelForward: true,
    clipboardAutosync: true
  })
  return {
    scid: '00000001',
    serverProc: new EventEmitter() as Transport['serverProc'],
    forwardSpec: 'tcp:12345',
    videoSocket: new FakeSocket() as unknown as Transport['videoSocket'],
    controlSocket: new FakeSocket() as unknown as Transport['controlSocket'],
    mediaStream,
    options: options as unknown as Transport['options'],
    videoSize: { width: 1080, height: 2400 },
    teardown: async () => {
      try {
        pushController?.close()
      } catch {
        // 已关
      }
    }
  }
}

const collectStates = (): ScreenStateMessage[] => {
  const send = (
    mocks.windowRef.current!.webContents as unknown as { send: ReturnType<typeof vi.fn> }
  ).send
  const calls = send.mock.calls as Array<[string, unknown]>
  return calls
    .filter(([channel]) => channel === IPC_CHANNELS.screenState)
    .map(([, payload]) => payload as ScreenStateMessage)
}

describe('建立期自动重试（无线闪断回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.windowRef.current = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow
  })

  it('首次失败自动重试一次后成功：connecting → ready', async () => {
    let calls = 0
    const { manager, establish } = await importManager(async () => {
      calls += 1
      if (calls === 1) throw new Error('连接 scrcpy video socket 超时')
      return makeTransport()
    })
    try {
      await manager.ensureSession({ id: 'd1', runId: 'r1', serial: WIRELESS_SERIAL })
      await vi.waitFor(
        () => {
          expect(collectStates().some((state) => state.status === 'ready')).toBe(true)
        },
        { timeout: 5000 }
      )
      expect(establish).toHaveBeenCalledTimes(2)
    } finally {
      await manager.destroyAll()
    }
  })

  it('两次都失败：error 态保留原始错误文案', async () => {
    const { manager, establish } = await importManager(async () => {
      throw new Error('连接 scrcpy video socket 超时')
    })
    try {
      await manager.ensureSession({ id: 'd1', runId: 'r1', serial: WIRELESS_SERIAL })
      await vi.waitFor(
        () => {
          expect(collectStates().at(-1)?.status).toBe('error')
        },
        { timeout: 5000 }
      )
      expect(collectStates().at(-1)?.error).toMatch(/video socket 超时/)
      expect(establish).toHaveBeenCalledTimes(2)
    } finally {
      await manager.destroyAll()
    }
  })
})

// ---- Fix B：熄屏唤醒 ----

describe('无线熄屏唤醒', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.windowRef.current = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('激活无线视图：下发 KEYCODE_WAKEUP(224)；USB serial 不下发', async () => {
    const { manager, adbRun } = await importManager(async () => makeTransport())
    try {
      await manager.ensureSession({ id: 'd1', runId: 'r1', serial: WIRELESS_SERIAL })
      await vi.waitFor(() =>
        expect(collectStates().some((state) => state.status === 'ready')).toBe(true)
      )
      const activate = await handlerFor(IPC_CHANNELS.screenActivate)
      await activate({}, { id: 'd1', viewToken: 'vt-w' })
      await new Promise((resolve) => setImmediate(resolve))
      expect(adbRun.mock.calls.some(([, args]) => args.join(' ').includes('keyevent 224'))).toBe(
        true
      )

      await manager.ensureSession({ id: 'd2', runId: 'r2', serial: USB_SERIAL })
      await vi.waitFor(() =>
        expect(collectStates().some((state) => state.status === 'ready')).toBe(true)
      )
      const before = adbRun.mock.calls.length
      await activate({}, { id: 'd2', viewToken: 'vt-u' })
      await new Promise((resolve) => setImmediate(resolve))
      expect(adbRun.mock.calls.length).toBe(before)
    } finally {
      await manager.destroyAll()
    }
  })

  it('恢复节拍（无线）：resetVideo 同时下发唤醒', async () => {
    const reset = vi.spyOn(SafeControlMessageWriter.prototype, 'resetVideo')
    const { manager, adbRun } = await importManager(async () => makeTransport())
    const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
    try {
      await manager.ensureSession({ id: 'd1', runId: 'r1', serial: WIRELESS_SERIAL })
      await flush()
      const activate = await handlerFor(IPC_CHANNELS.screenActivate)
      vi.useFakeTimers()
      await activate({}, { id: 'd1', viewToken: 'vt-r' })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(9_000)
      vi.useRealTimers()
      expect(reset).toHaveBeenCalledTimes(3)
      expect(adbRun.mock.calls.some(([, args]) => args.join(' ').includes('keyevent 224'))).toBe(
        true
      )
    } finally {
      vi.useRealTimers()
      await manager.destroyAll()
    }
  })
})

const handlerFor = async (
  channel: string
): Promise<(event: unknown, raw: unknown) => Promise<unknown>> => {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`handler 未注册：${channel}`)
  return call[1] as (event: unknown, raw: unknown) => Promise<unknown>
}
