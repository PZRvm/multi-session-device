// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      clipboardAutosync: true
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

  describe('设备控制回包（scrcpy 3.x 真实线格式）', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const ackMessage = (sequence: bigint): Buffer => {
      const message = Buffer.alloc(9)
      message[0] = 1
      message.writeBigUInt64BE(sequence, 1)
      return message
    }
    const clipboardMessage = (text: string): Buffer => {
      const content = Buffer.from(text, 'utf8')
      const message = Buffer.alloc(5 + content.length)
      message.writeUInt32BE(content.length, 1)
      content.copy(message, 5)
      return message
    }
    const flush = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(0)
    }
    const openClipboardView = async (
      harness: Harness,
      id: string,
      serial: string
    ): Promise<{
      socket: FakeSocket
      paste: (text?: string) => Promise<unknown>
      sequence: () => bigint
    }> => {
      const runId = `${id}-run`
      await harness.manager.ensureSession({ id, runId, serial })
      await vi.waitFor(() => {
        expect(
          collect().states.some((state) => state.deviceId === id && state.status === 'ready')
        ).toBe(true)
      })
      const activate = await handlerFor(IPC_CHANNELS.screenActivate)
      const ready = (await activate({}, { id, viewToken: `${id}-view` })) as ScreenStateMessage
      const input = await handlerFor(IPC_CHANNELS.screenInput)
      const socket = harness.transportOf(serial).controlSocket as unknown as FakeSocket
      const paste = (text = '中文 😀 clipboard'): Promise<unknown> =>
        input(
          {},
          {
            deviceId: id,
            runId,
            streamId: ready.streamId,
            generation: ready.generation,
            viewToken: `${id}-view`,
            width: 1080,
            height: 2400,
            input: { kind: 'text', text, ime: true }
          }
        )
      const sequence = (): bigint => {
        const packet = socket.written.findLast((message) => message[0] === 9)
        if (!packet) throw new Error('SET_CLIPBOARD 未写入')
        return Buffer.from(packet).readBigUInt64BE(1)
      }
      return { socket, paste, sequence }
    }
    const observe = (
      pending: Promise<unknown>
    ): { settled: ReturnType<typeof vi.fn>; result: Promise<unknown> } => {
      const settled = vi.fn()
      const result = pending.then(
        (value) => {
          settled()
          return value
        },
        (error: Error) => {
          settled()
          return error
        }
      )
      return { settled, result }
    }

    it.each(['immediate', 'deferred'] as const)(
      '%s socket.write callback 失败关闭会话、清 ACK，迟到回包无效',
      async (mode) => {
        const harness = await importManager()
        try {
          const view = await openClipboardView(harness, 'd1', 'emulator-5554')
          const failure = new Error('synthetic socket write failed')
          view.socket.write = (chunk, callback) => {
            view.socket.written.push(chunk)
            if (mode === 'immediate') callback?.(failure)
            else setTimeout(() => callback?.(failure), 0)
            return true
          }
          const pending = observe(view.paste())
          await flush()
          expect(await pending.result).toBe(failure)
          expect(pending.settled).toHaveBeenCalledOnce()
          expect(harness.manager.activeDeviceId()).toBeNull()
          expect(
            collect().states.some((state) => state.error?.includes('synthetic socket write failed'))
          ).toBe(true)
          expect(vi.getTimerCount()).toBe(0)
          expect(view.socket.listenerCount('data')).toBe(0)
          view.socket.emit('data', ackMessage(view.sequence()))
          await harness.manager.destroySession('d1')
          await vi.advanceTimersByTimeAsync(2000)
          expect(pending.settled).toHaveBeenCalledOnce()
        } finally {
          await harness.manager.destroyAll()
        }
      }
    )

    it('UTF-8 SET_CLIPBOARD 与逐字节 ACK 提前完成，未知/迟到 ACK 不误报', async () => {
      const harness = await importManager()
      try {
        const view = await openClipboardView(harness, 'd1', 'emulator-5554')
        view.socket.emit('data', ackMessage(99n))
        await flush()
        const text = '中文 😀 clipboard'
        const pending = observe(view.paste(text))
        await flush()
        const packet = Buffer.from(view.socket.written.findLast((message) => message[0] === 9)!)
        expect(packet.readUInt32BE(10)).toBe(Buffer.byteLength(text, 'utf8'))
        expect(packet.subarray(14).toString('utf8')).toBe(text)
        const sequence = view.sequence()
        for (const byte of ackMessage(sequence)) {
          view.socket.emit('data', Buffer.from([byte]))
          await flush()
        }
        expect(pending.settled).toHaveBeenCalledOnce()
        expect(await pending.result).toBeUndefined()
        view.socket.emit('data', ackMessage(sequence))
        await flush()
        expect(collect().states.some((state) => state.status === 'error')).toBe(false)
      } finally {
        await harness.manager.destroyAll()
      }
    })

    it('剪贴板同步与 ACK 分片/粘连正确消费，不覆盖宿主剪贴板', async () => {
      const harness = await importManager()
      try {
        const view = await openClipboardView(harness, 'd1', 'emulator-5554')
        const pending = observe(view.paste())
        await flush()
        const packet = Buffer.concat([
          clipboardMessage('设备剪贴板 😀'),
          ackMessage(view.sequence()),
          clipboardMessage('second')
        ])
        view.socket.emit('data', packet.subarray(0, 3))
        await flush()
        expect(pending.settled).not.toHaveBeenCalled()
        view.socket.emit('data', packet.subarray(3, 12))
        await flush()
        expect(pending.settled).not.toHaveBeenCalled()
        view.socket.emit('data', packet.subarray(12))
        await flush()
        expect(pending.settled).toHaveBeenCalledOnce()
        expect(await pending.result).toBeUndefined()
        expect(collect().states.some((state) => state.status === 'error')).toBe(false)
      } finally {
        await harness.manager.destroyAll()
      }
    })

    it('ACK 使用完整 64 位序列号，高 32 位碰巧相同不能匹配', async () => {
      const harness = await importManager()
      try {
        const view = await openClipboardView(harness, 'd1', 'emulator-5554')
        const pending = observe(view.paste())
        await flush()
        const sequence = view.sequence()
        view.socket.emit('data', ackMessage((sequence << 32n) | 0xdeadn))
        await flush()
        expect(pending.settled).not.toHaveBeenCalled()
        view.socket.emit('data', ackMessage(sequence))
        await flush()
        expect(pending.settled).toHaveBeenCalledOnce()
        expect(await pending.result).toBeUndefined()
      } finally {
        await harness.manager.destroyAll()
      }
    })

    it('两会话相同序列号仍隔离，切换不让另一 socket 结算旧请求', async () => {
      const harness = await importManager()
      try {
        const first = await openClipboardView(harness, 'd1', 'emulator-5554')
        const firstPending = observe(first.paste())
        await flush()
        const second = await openClipboardView(harness, 'd2', 'emulator-5556')
        const secondPending = observe(second.paste())
        await flush()
        expect(first.sequence()).toBe(second.sequence())
        second.socket.emit('data', ackMessage(second.sequence()))
        await flush()
        expect(secondPending.settled).toHaveBeenCalledOnce()
        expect(firstPending.settled).not.toHaveBeenCalled()
        first.socket.emit('data', ackMessage(first.sequence()))
        await flush()
        expect(firstPending.settled).toHaveBeenCalledOnce()
        expect(await firstPending.result).toBeUndefined()
        expect(await secondPending.result).toBeUndefined()
      } finally {
        await harness.manager.destroyAll()
      }
    })

    it.each(['close', 'end', 'socket-error', 'stop'] as const)(
      '%s 立即拒绝等待中的粘贴，取消宽限计时器',
      async (mode) => {
        const harness = await importManager()
        try {
          const view = await openClipboardView(harness, 'd1', 'emulator-5554')
          const pending = observe(view.paste())
          await flush()
          if (mode === 'stop') await harness.manager.destroySession('d1')
          else if (mode === 'socket-error') view.socket.emit('error', new Error('connection reset'))
          else view.socket.emit(mode)
          await flush()
          expect(pending.settled).toHaveBeenCalledOnce()
          expect(await pending.result).toBeInstanceOf(Error)
          expect(harness.manager.activeDeviceId()).toBeNull()
          if (mode !== 'stop')
            expect(collect().states.some((state) => state.status === 'error')).toBe(true)
          const count = pending.settled.mock.calls.length
          await vi.advanceTimersByTimeAsync(2000)
          expect(pending.settled).toHaveBeenCalledTimes(count)
        } finally {
          await harness.manager.destroyAll()
        }
      }
    )

    it.each(['unknown-type', 'oversize-message', 'oversize-buffer'] as const)(
      '%s 失败清理并拒绝 pending，而不等待超时',
      async (mode) => {
        const harness = await importManager()
        try {
          const view = await openClipboardView(harness, 'd1', 'emulator-5554')
          const pending = observe(view.paste())
          await flush()
          let payload: Buffer
          if (mode === 'unknown-type') payload = Buffer.from([255])
          else if (mode === 'oversize-message') {
            payload = Buffer.alloc(5)
            payload.writeUInt32BE(1024 * 1024 + 1, 1)
          } else payload = Buffer.alloc(2 * 1024 * 1024 + 1)
          view.socket.emit('data', payload)
          await flush()
          expect(pending.settled).toHaveBeenCalledOnce()
          expect(await pending.result).toBeInstanceOf(Error)
          expect(collect().states.some((state) => state.status === 'error')).toBe(true)
          expect(harness.manager.activeDeviceId()).toBeNull()
        } finally {
          await harness.manager.destroyAll()
        }
      }
    )

    it('无 ACK 时等足 2 秒后按已派发收口，迟到 ACK 不重复结算', async () => {
      const harness = await importManager()
      try {
        const view = await openClipboardView(harness, 'd1', 'emulator-5554')
        const pending = observe(view.paste())
        await flush()
        await vi.advanceTimersByTimeAsync(1999)
        expect(pending.settled).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(pending.settled).toHaveBeenCalledOnce()
        expect(await pending.result).toBeUndefined()
        view.socket.emit('data', ackMessage(view.sequence()))
        await flush()
        expect(pending.settled).toHaveBeenCalledOnce()
        expect(collect().states.some((state) => state.status === 'error')).toBe(false)
      } finally {
        await harness.manager.destroyAll()
      }
    })

    it('64 次无 ACK 已派发占满库等待预算，第 65 次拒绝；迟到 ACK 释放一个位置', async () => {
      const harness = await importManager()
      try {
        const view = await openClipboardView(harness, 'd1', 'emulator-5554')
        let firstSequence = 0n
        for (let index = 0; index < 64; index += 1) {
          const pending = observe(view.paste(`unacked-${index}`))
          await flush()
          if (index === 0) firstSequence = view.sequence()
          await vi.advanceTimersByTimeAsync(2000)
          expect(await pending.result).toBeUndefined()
          expect(pending.settled).toHaveBeenCalledOnce()
        }
        const writesBefore = view.socket.written.filter((message) => message[0] === 9).length
        expect(writesBefore).toBe(64)
        const overBudget = observe(view.paste('over-budget'))
        await flush()
        expect(overBudget.settled).toHaveBeenCalledOnce()
        const rejection = await overBudget.result
        expect(rejection).toBeInstanceOf(Error)
        expect((rejection as Error).message).toContain('剪贴板确认积压')
        expect(view.socket.written.filter((message) => message[0] === 9)).toHaveLength(writesBefore)

        view.socket.emit('data', ackMessage(firstSequence))
        await flush()
        const resumed = observe(view.paste('resumed'))
        await flush()
        expect(view.socket.written.filter((message) => message[0] === 9)).toHaveLength(65)
        view.socket.emit('data', ackMessage(view.sequence()))
        await flush()
        expect(await resumed.result).toBeUndefined()
        expect(resumed.settled).toHaveBeenCalledOnce()
        expect(collect().states.some((state) => state.status === 'error')).toBe(false)
      } finally {
        await harness.manager.destroyAll()
      }
    })
  })
})

describe('息屏唤醒冻结回归（2026-10-15 真机 Wi-Fi 投屏调查）', () => {
  beforeEach(() => {
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
  it('PTS 跨度清链 + 突发超预算：waitingResync 悬空后看门狗必须自救（resetVideo）', async () => {
    const { manager, transportOf } = await importManager()
    const ctl = (): number =>
      (transportOf('emulator-5554').controlSocket as unknown as FakeSocket).written.length
    const activate = await handlerFor(IPC_CHANNELS.screenActivate)
    const ack = await handlerFor(IPC_CHANNELS.screenAck)

    await manager.ensureSession({ id: 'd1', runId: 'r1', serial: 'emulator-5554' })
    await vi.waitFor(() => {
      expect(collect().states.some((state) => state.status === 'ready')).toBe(true)
    })
    await activate({ sender: {} }, { id: 'd1', viewToken: 'vt1' })

    const push = transportOf('emulator-5554').__push
    // 建链：配置 + 关键帧 + 静态增量，全量 ACK（resyncArmed 重挂、outbox 清空）
    push({ type: 'configuration', data: new Uint8Array([1]) })
    push({ type: 'data', pts: 0n, keyframe: true, data: new Uint8Array(10) })
    for (let i = 1; i <= 3; i++) {
      push({ type: 'data', pts: BigInt(33_000 * i), keyframe: false, data: new Uint8Array(10) })
    }
    await vi.waitFor(() => {
      expect(collect().packets).toHaveLength(5)
    })
    await ack({ sender: {} }, { viewToken: 'vt1', generation: 1, throughSeq: 4 })

    // 「息屏」后唤醒：增量帧 PTS 跨过睡眠间隔（10s ≫ 1.5s 预算）→ GopCache 清链
    // 等关键帧；紧接着无关键帧突发 >16 包 → 超预算 → sendResync 空手而归 →
    // waitingResync=true 开始丢包（渲染端画面就此冻结）
    const beforeFreeze = collect().packets.length
    for (let i = 0; i < 20; i++) {
      push({
        type: 'data',
        pts: 10_000_000n + BigInt(33_000 * i),
        keyframe: false,
        data: new Uint8Array(10)
      })
    }
    // 渲染端如实 ACK 已收到的包（ACK 只看收到不看画面）→ outbox 归零
    await vi.waitFor(() => {
      expect(collect().packets.length).toBeGreaterThan(beforeFreeze)
    })
    await ack(
      { sender: {} },
      { viewToken: 'vt1', generation: 1, throughSeq: collect().packets.at(-1)!.seq }
    )

    // 冻结期：持续有新帧到达（唤醒后的锁屏动画/用户滑动）但全部被丢
    const frozenAt = collect().packets.length
    expect(frozenAt).toBeGreaterThan(beforeFreeze)
    // 看门狗（ACK_STALL_MS=3s）应识别「waitingResync 悬空」并重试：nullReplayStalls
    // 自增到 2 → resetVideo 下发编码器重置 → 死锁解除。无此分支则永不恢复。
    const ctlBefore = ctl()
    const deadline = Date.now() + 8_000
    for (;;) {
      push({
        type: 'data',
        pts: 10_700_000n + BigInt((Math.random() * 1_000_000) | 0),
        keyframe: false,
        data: new Uint8Array(10)
      })
      if (ctl() > ctlBefore) break
      if (Date.now() > deadline) throw new Error('看门狗未在 8s 内自救——waitingResync 死锁仍在')
      await new Promise((resolve) => setTimeout(resolve, 400))
    }

    // resetVideo → 编码器重置 → 新配置包 → 解除悬空，帧恢复流动
    push({ type: 'configuration', data: new Uint8Array([2]) })
    push({ type: 'data', pts: 20_000_000n, keyframe: true, data: new Uint8Array(10) })
    await vi.waitFor(() => {
      const packets = collect().packets
      expect(packets.length).toBeGreaterThan(frozenAt)
    })
  }, 20_000)
})
