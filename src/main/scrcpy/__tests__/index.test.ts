// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import { ScrcpyInstanceId } from '@yume-chan/scrcpy'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import type { ScreenPacketMessage, ScreenStateMessage } from '@shared/types'
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

  const manager = createScrcpyManager({
    adbPath: () => '/adb',
    toolEnv: () => ({}),
    getMainWindow: () => mocks.windowRef.current,
    isMainSender: () => true,
    establish: fakeEstablish as unknown as (typeof import('../transport'))['establishTransport']
  })
  manager.registerIpc()
  return {
    manager,
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
