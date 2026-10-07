// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import { ScrcpyInstanceId } from '@yume-chan/scrcpy'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import type { ScreenInput, ScreenPacketMessage, ScreenStateMessage } from '@shared/types'
import { createScrcpyManager, MAX_UNACKED_PACKETS } from '../index'
import type { Transport, TransportDeps } from '../transport'

class FakeSocket extends EventEmitter {
  written: Buffer[] = []
  destroyed = false
  write = (chunk: Buffer, cb?: (error?: Error) => void): boolean => {
    this.written.push(chunk)
    cb?.()
    return true
  }
  end = (cb?: () => void): void => {
    cb?.()
  }
  destroy = (): void => {
    this.destroyed = true
    this.emit('close')
  }
}

interface PushableTransport extends Transport {
  __push: (packet: ScrcpyMediaStreamPacket) => void
}

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

interface Harness {
  manager: ReturnType<typeof createScrcpyManager>
  transportOf: (serial: string) => PushableTransport
  adbRun: ReturnType<typeof vi.fn>
}

const importManager = async (): Promise<Harness> => {
  const { createScrcpyManager } = await import('../index')

  const transportsBySerial = new Map<string, PushableTransport>()
  const fakeEstablish = vi.fn(async (deps: TransportDeps): Promise<Transport> => {
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
      clipboardAutosync: false
    })
    const transport: Transport = {
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
    const pushable = transport as PushableTransport
    pushable['__push'] = (packet) => {
      pushController?.enqueue(packet)
    }
    transportsBySerial.set(deps.serial, pushable)
    return transport
  })

  const adbRun = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
  const manager = createScrcpyManager({
    adbPath: () => '/adb',
    toolEnv: () => ({}),
    getMainWindow: () => mocks.windowRef.current,
    isMainSender: () => true,
    runAdb: adbRun,
    establish: fakeEstablish as unknown as (typeof import('../transport'))['establishTransport']
  })
  manager.registerIpc()
  return {
    manager,
    adbRun,
    transportOf: (serial: string) => {
      const transport = transportsBySerial.get(serial)
      if (!transport) throw new Error(`无 transport：${serial}`)
      return transport
    }
  }
}

const handlerFor = async (
  channel: string
): Promise<(event: unknown, raw: unknown) => Promise<unknown>> => {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`handler 未注册：${channel}`)
  return call[1] as (event: unknown, raw: unknown) => Promise<unknown>
}

describe('ScrcpyManager（fake transport）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.windowRef.current = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow
  })

  const collect = (): { states: ScreenStateMessage[]; packets: ScreenPacketMessage[] } => {
    const send = (
      mocks.windowRef.current!.webContents as unknown as { send: ReturnType<typeof vi.fn> }
    ).send
    const calls = send.mock.calls as Array<[string, unknown]>
    return {
      states: calls
        .filter(([channel]) => channel === IPC_CHANNELS.screenState)
        .map(([, payload]) => payload as ScreenStateMessage),
      packets: calls
        .filter(([channel]) => channel === IPC_CHANNELS.screenPacket)
        .map(([, payload]) => payload as ScreenPacketMessage)
    }
  }

  it('建会话：connecting → ready 状态推送；未激活视图不收包（后台只缓存）', async () => {
    const { manager, transportOf } = await importManager()
    await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
    await vi.waitFor(() => {
      expect(collect().states.some((state) => state.status === 'ready')).toBe(true)
    })
    const ready = collect().states.find((state) => state.status === 'ready')!
    expect(ready.format).toEqual({ codec: 'h264', width: 1080, height: 2400 })

    transportOf('emulator-5554').__push({ type: 'configuration', data: new Uint8Array([1]) })
    transportOf('emulator-5554').__push({
      type: 'data',
      pts: 0n,
      keyframe: true,
      data: new Uint8Array(10)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(collect().packets).toHaveLength(0)
    await manager.destroyAll()
  })

  it('激活 → 突发回放（配置+链，带 viewToken）；实时包衔接 seq', async () => {
    const { manager, transportOf } = await importManager()
    await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
    const transport = transportOf('emulator-5554')
    await vi.waitFor(() =>
      expect(collect().states.some((state) => state.status === 'ready')).toBe(true)
    )
    transport.__push({ type: 'configuration', data: new Uint8Array([1]) })
    transport.__push({ type: 'data', pts: 0n, keyframe: true, data: new Uint8Array(10) })
    transport.__push({ type: 'data', pts: 33n, keyframe: false, data: new Uint8Array(10) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(collect().packets).toHaveLength(0) // 后台不转发

    const activate = await handlerFor(IPC_CHANNELS.screenActivate)
    const state = (await activate({}, { id: 'd1', viewToken: 'vt-1' })) as ScreenStateMessage
    expect(state.status).toBe('ready')

    const burst = collect().packets
    expect(burst).toHaveLength(3)
    expect(burst.every((packet) => packet.viewToken === 'vt-1')).toBe(true)
    expect(burst[0].type).toBe('configuration')

    transport.__push({ type: 'data', pts: 66n, keyframe: false, data: new Uint8Array(10) })
    await vi.waitFor(() => expect(collect().packets).toHaveLength(4))
    expect(collect().packets[3].seq).toBe(collect().packets[2].seq + 1)
    expect(collect().packets[3].viewToken).toBe('vt-1')
    await manager.destroyAll()
  })

  it('ACK 清发送窗；超预算触发重同步突发；旧 token ACK 忽略', async () => {
    const { manager, transportOf } = await importManager()
    await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
    const transport = transportOf('emulator-5554')
    await vi.waitFor(() =>
      expect(collect().states.some((state) => state.status === 'ready')).toBe(true)
    )
    transport.__push({ type: 'configuration', data: new Uint8Array([1]) })
    transport.__push({ type: 'data', pts: 0n, keyframe: true, data: new Uint8Array(10) })
    await new Promise((resolve) => setTimeout(resolve, 20)) // 等 reader 消化入缓存
    const activate = await handlerFor(IPC_CHANNELS.screenActivate)
    await activate({}, { id: 'd1', viewToken: 'vt-1' })
    const burst = collect().packets
    expect(burst).toHaveLength(2)
    const generation = burst[0].generation
    const lastSeq = burst[1].seq

    const ack = await handlerFor(IPC_CHANNELS.screenAck)
    ack({}, { viewToken: 'vt-old', generation, throughSeq: lastSeq }) // 旧 token 忽略
    ack({}, { viewToken: 'vt-1', generation, throughSeq: lastSeq }) // 合法清窗

    const before = collect().packets.length
    for (let index = 0; index < MAX_UNACKED_PACKETS + 2; index += 1) {
      transport.__push({
        type: 'data',
        pts: BigInt(1_000 + index),
        keyframe: false,
        data: new Uint8Array(10)
      })
    }
    await vi.waitFor(() => {
      const sent = collect().packets.slice(before)
      expect(sent.some((packet) => packet.type === 'configuration')).toBe(true)
    })
    await manager.destroyAll()
  })

  it('输入守卫：未激活拒绝；归属过期与尺寸不符拒绝', async () => {
    const { manager } = await importManager()
    await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
    const input = await handlerFor(IPC_CHANNELS.screenInput)
    const request = {
      deviceId: 'd1',
      runId: 'r1',
      streamId: 'whatever',
      generation: 0,
      viewToken: 'vt',
      width: 1080,
      height: 2400,
      input: { kind: 'rotate' }
    }
    await expect(input({}, request)).rejects.toThrow('当前没有活动视图')

    const activate = await handlerFor(IPC_CHANNELS.screenActivate)
    await activate({}, { id: 'd1', viewToken: 'vt-1' })
    const ready = collect()
      .states.filter((state) => state.status === 'ready')
      .at(-1)!
    const live = {
      ...request,
      streamId: ready.streamId,
      generation: ready.generation,
      viewToken: 'vt-1'
    }
    await expect(input({}, { ...live, viewToken: 'stale' })).rejects.toThrow('归属过期')
    await expect(input({}, { ...live, width: 999 })).rejects.toThrow('画面尺寸')
    await manager.destroyAll()
  })

  it.each(['success', 'nonzero', 'spawn-error', 'view-changed', 'session-stopped'])(
    '旋转锁定绑定活动设备，失败或等待期间归属变化不发控制消息：%s',
    async (outcome) => {
      const { manager, transportOf, adbRun } = await importManager()
      await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5556' })
      const activate = await handlerFor(IPC_CHANNELS.screenActivate)
      await activate({}, { id: 'd1', viewToken: 'vt-1' })
      const ready = collect()
        .states.filter((state) => state.status === 'ready')
        .at(-1)!
      const input = await handlerFor(IPC_CHANNELS.screenInput)
      const transport = transportOf('emulator-5556')
      const socket = transport.controlSocket as unknown as FakeSocket
      socket.written.length = 0
      let finish!: (result: { code: number; stdout: string; stderr: string }) => void
      let fail!: (error: Error) => void
      adbRun.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve
            fail = reject
          })
      )
      const pending = input(
        {},
        {
          deviceId: 'd1',
          runId: 'r1',
          streamId: ready.streamId,
          generation: ready.generation,
          viewToken: 'vt-1',
          width: 1080,
          height: 2400,
          input: { kind: 'rotate' }
        }
      )
      const result = pending.then(
        () => null,
        (error: Error) => error
      )
      await vi.waitFor(() => expect(adbRun).toHaveBeenCalledOnce())
      expect(adbRun).toHaveBeenCalledWith(
        '/adb',
        ['-s', 'emulator-5556', 'shell', 'wm', 'user-rotation', 'lock'],
        10_000
      )
      expect(socket.written).toHaveLength(0)
      if (outcome === 'view-changed') await activate({}, { id: null, viewToken: 'inactive' })
      if (outcome === 'session-stopped') await manager.destroySession('d1')
      if (outcome === 'spawn-error') fail(new Error('adb unavailable'))
      else finish({ code: outcome === 'nonzero' ? 1 : 0, stdout: '', stderr: 'permission denied' })
      if (outcome === 'success') {
        expect(await result).toBeNull()
        expect(socket.written).toEqual([new Uint8Array([11])])
      } else {
        expect((await result)?.message).toContain(
          outcome === 'nonzero'
            ? 'permission denied'
            : outcome === 'spawn-error'
              ? 'adb unavailable'
              : '归属过期'
        )
        expect(socket.written).toHaveLength(0)
      }
      await manager.destroyAll()
    }
  )

  it.each([0, 1])(
    '旋转先释放旧键和触点，等待期间丢弃所有输入且不补发，成功/失败后恢复：code=%s',
    async (code) => {
      const { manager, transportOf, adbRun } = await importManager()
      await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
      const activate = await handlerFor(IPC_CHANNELS.screenActivate)
      const ready = (await activate({}, { id: 'd1', viewToken: 'vt-1' })) as ScreenStateMessage
      const input = await handlerFor(IPC_CHANNELS.screenInput)
      const live = {
        deviceId: 'd1',
        runId: 'r1',
        streamId: ready.streamId,
        generation: ready.generation,
        viewToken: 'vt-1',
        width: 1080,
        height: 2400
      }
      const touch = { kind: 'touch', action: 'down', pointerId: 0, x: 0.5, y: 0.5, pressure: 1 }
      const socket = transportOf('emulator-5554').controlSocket as unknown as FakeSocket
      socket.written.length = 0
      let finish!: (result: { code: number; stdout: string; stderr: string }) => void
      adbRun.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      await input({}, { ...live, input: touch })
      await input({}, { ...live, input: { kind: 'keycode', key: 'arrow-down', down: true } })
      const pending = input({}, { ...live, input: { kind: 'rotate' } }).then(
        () => null,
        (error: Error) => error
      )
      await vi.waitFor(() => expect(adbRun).toHaveBeenCalledOnce())
      try {
        const dropped: ScreenInput[] = [
          { kind: 'touch', action: 'down', pointerId: 1, x: 0.5, y: 0.5, pressure: 1 },
          { kind: 'touch', action: 'move', pointerId: 0, x: 0.7, y: 0.7, pressure: 1 },
          { kind: 'touch', action: 'up', pointerId: 0, x: 0.7, y: 0.7, pressure: 0 },
          { kind: 'touch', action: 'cancel', pointerId: 0, x: 0, y: 0, pressure: 0 },
          { kind: 'keycode', key: 'enter', down: true },
          { kind: 'keycode', key: 'arrow-down', down: false },
          { kind: 'button', button: 'home' },
          { kind: 'text', text: 'dropped', ime: false },
          { kind: 'text', text: '丢弃', ime: true },
          { kind: 'release-all' },
          { kind: 'rotate' }
        ]
        for (const entry of dropped)
          await expect(input({}, { ...live, input: entry })).resolves.toBeUndefined()
        await expect(
          input({}, { ...live, viewToken: 'old', input: { kind: 'rotate' } })
        ).rejects.toThrow('归属过期')
        await expect(input({}, { ...live, input: { kind: 'unknown' } })).rejects.toThrow(
          '非法的入参'
        )
        expect(adbRun).toHaveBeenCalledOnce()
        finish({ code, stdout: '', stderr: code ? 'permission denied' : '' })
        expect((await pending)?.message ?? null).toBe(
          code ? '锁定屏幕旋转失败：permission denied' : null
        )
        const messages = socket.written.map((message) =>
          message[0] === 2
            ? `touch:${message[1]}`
            : message[0] === 0
              ? `key:${message[1]}`
              : `type:${message[0]}`
        )
        expect(messages).toEqual(
          code
            ? ['touch:0', 'key:0', 'touch:1', 'key:1']
            : ['touch:0', 'key:0', 'touch:1', 'key:1', 'type:11']
        )
        await expect(input({}, { ...live, input: touch })).resolves.toBeUndefined()
        await expect(input({}, { ...live, input: { kind: 'rotate' } })).resolves.toBeUndefined()
        expect(adbRun).toHaveBeenCalledTimes(2)
      } finally {
        finish({ code: 0, stdout: '', stderr: '' })
        await pending
        await manager.destroyAll()
      }
    }
  )

  it('destroySession 幂等；retry 校验代次后重建', async () => {
    const { manager } = await importManager()
    await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
    await manager.destroySession('d1')
    await manager.destroySession('d1')
    expect(manager.activeDeviceId()).toBeNull()

    await manager.ensureSession({ id: 'd2', runId: 'r2', serial: 'emulator-5556' })
    const retry = await handlerFor(IPC_CHANNELS.screenRetry)
    await expect(retry({}, { id: 'd2', runId: 'stale' })).rejects.toThrow('代次过期')
    await retry({}, { id: 'd2', runId: 'r2' })
    await manager.destroyAll()
  })
})
