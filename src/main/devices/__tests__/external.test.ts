import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import type { ExternalDeps, TrackDeviceEntry } from '../external'

const migrationFlag = vi.hoisted(() => ({ active: false }))
vi.mock('../../emulator/sdkMigration', () => ({
  isMigrationActive: () => migrationFlag.active,
  setMigrationFlagForTest: (value: boolean) => {
    migrationFlag.active = value
  }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/userdata') }
}))

// externalOrder 偏好落盘接缝（plan 2026-11-09）：import 图内 fs 均为函数体调用，无 import 期 IO；
// default 别名兜底 CJS/默认导入消费者（纯对象 mock 缺 default 会炸 import）
const fsMocks = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }))
vi.mock('node:fs/promises', () => ({ ...fsMocks, default: fsMocks }))

// 真机域测试（plan 2026-10-13-real-device-usb-and-apk-install）：纯解析函数 +
// track 客户端（connect/ensureServer 接缝注入，fake timers 驱动退避与握手超时）。

const OKAY = Buffer.from('OKAY')
const frameOf = (payload: string): Buffer =>
  Buffer.concat([Buffer.from(payload.length.toString(16).padStart(4, '0')), Buffer.from(payload)])
const LONG_REQUEST = Buffer.from('0014host:track-devices-l')
const SHORT_REQUEST = Buffer.from('0012host:track-devices')

class FakeSocket extends EventEmitter {
  write = vi.fn()
  destroy = vi.fn()
}

const flush = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0)

const fresh = async (): Promise<typeof import('../external')> => {
  vi.resetModules()
  return import('../external')
}

interface DepsBag {
  deps: ExternalDeps
  sockets: FakeSocket[]
  broadcast: ReturnType<typeof vi.fn>
  onSession: ReturnType<typeof vi.fn>
  ensureServer: ReturnType<typeof vi.fn>
}

const makeDeps = (overrides: Partial<ExternalDeps> = {}): DepsBag => {
  const sockets: FakeSocket[] = []
  const broadcast = vi.fn()
  const onSession = vi.fn()
  const ensureServer = vi.fn(async () => null)
  const deps: ExternalDeps = {
    broadcast,
    isMainSender: () => true,
    onSession,
    connect: (() => {
      const sock = new FakeSocket()
      sockets.push(sock)
      return sock as unknown as Socket
    }) as ExternalDeps['connect'],
    ensureServer,
    ...overrides
  }
  return { deps, sockets, broadcast, onSession, ensureServer }
}

const listHandler = (): ((event: { sender: Electron.WebContents }) => unknown) => {
  const call = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === 'devices:external-list')
  if (!call) throw new Error('devices:external-list handler not registered')
  return call[1] as never
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseTrackDevices', () => {
  const parse = async (payload: string): Promise<TrackDeviceEntry[]> =>
    (await fresh()).parseTrackDevices(payload)

  it('长格式行：serial/state/属性区 model', async () => {
    expect(
      await parse(
        'R58N\tdevice usb:1-1 product:raven model:Pixel_6_Pro device:raven transport_id:1'
      )
    ).toEqual([{ serial: 'R58N', state: 'device', model: 'Pixel_6_Pro' }])
  })

  it('真实载荷（空格对齐长格式，2026-10-13 EBG_AN00 实测）——serial 与 state 间是空格串', async () => {
    expect(
      await parse(
        'DSLDU20B12002637       device usb:0-1 product:EBG-AN00 model:EBG_AN00 device:HWEBG transport_id:2\n'
      )
    ).toEqual([{ serial: 'DSLDU20B12002637', state: 'device', model: 'EBG_AN00' }])
  })

  it('短格式行：无属性区 model 为 null', async () => {
    expect(await parse('abc\tdevice')).toEqual([{ serial: 'abc', state: 'device', model: null }])
  })

  it('非法行丢弃：无 tab、空 state、空行', async () => {
    expect(await parse('no-tab-here\n\n\tdevice\nx\t')).toEqual([])
  })

  it('多行 + 空值 model 归 null', async () => {
    expect(await parse('a\tdevice model:\nb\toffline')).toEqual([
      { serial: 'a', state: 'device', model: null },
      { serial: 'b', state: 'offline', model: null }
    ])
  })
})

describe('toExternalDevices', () => {
  it('剔除 emulator- 与 adb- 前缀（AVD 归既有列表、adb- 是 mDNS 占位）', async () => {
    const mod = await fresh()
    expect(
      mod.toExternalDevices([
        { serial: 'emulator-5554', state: 'device', model: null },
        { serial: 'adb-0a388e93-abc123._adb-tls-connect._tcp', state: 'device', model: null },
        { serial: 'R58N', state: 'device', model: 'Pixel_6_Pro' }
      ])
    ).toEqual([
      {
        id: 'R58N',
        serial: 'R58N',
        transport: 'usb',
        state: 'device',
        model: 'Pixel_6_Pro'
      }
    ])
  })

  it('serial 含 : 判 wireless；未知 state 归 offline', async () => {
    const mod = await fresh()
    expect(
      mod.toExternalDevices([
        { serial: '192.168.1.5:5555', state: 'offline', model: null },
        { serial: 'X', state: 'recovery', model: null }
      ])
    ).toEqual([
      {
        id: '192.168.1.5:5555',
        serial: '192.168.1.5:5555',
        transport: 'wireless',
        state: 'offline',
        model: null
      },
      { id: 'X', serial: 'X', transport: 'usb', state: 'offline', model: null }
    ])
  })
})

describe('createTrackParser', () => {
  const makeParser = async (): Promise<{
    parser: { push: (chunk: Buffer) => void }
    onList: ReturnType<typeof vi.fn>
    onFail: ReturnType<typeof vi.fn>
  }> => {
    const onList = vi.fn()
    const onFail = vi.fn()
    return { parser: (await fresh()).createTrackParser({ onList, onFail }), onList, onFail }
  }

  it('OKAY + 单帧一次到达', async () => {
    const { parser, onList, onFail } = await makeParser()
    parser.push(Buffer.concat([OKAY, frameOf('a\tdevice')]))
    expect(onList).toHaveBeenCalledWith('a\tdevice')
    expect(onFail).not.toHaveBeenCalled()
  })

  it('跨 chunk 半包收敛', async () => {
    const { parser, onList } = await makeParser()
    const whole = Buffer.concat([OKAY, frameOf('a\tdevice')])
    parser.push(whole.subarray(0, 3))
    parser.push(whole.subarray(3, 9))
    parser.push(whole.subarray(9))
    expect(onList).toHaveBeenCalledTimes(1)
    expect(onList).toHaveBeenCalledWith('a\tdevice')
  })

  it('单 chunk 多帧逐个分发', async () => {
    const { parser, onList } = await makeParser()
    parser.push(Buffer.concat([OKAY, frameOf('a\tdevice'), frameOf('b\toffline')]))
    expect(onList).toHaveBeenCalledTimes(2)
    expect(onList).toHaveBeenLastCalledWith('b\toffline')
  })

  it('FAIL 握手 → onFail 带原因', async () => {
    const { parser, onList, onFail } = await makeParser()
    parser.push(Buffer.concat([Buffer.from('FAIL'), frameOf('unknown service')]))
    expect(onFail).toHaveBeenCalledWith('unknown service')
    expect(onList).not.toHaveBeenCalled()
  })

  it('非法握手字节 → onFail', async () => {
    const { parser, onFail } = await makeParser()
    parser.push(Buffer.from('XXXX'))
    expect(onFail).toHaveBeenCalledTimes(1)
  })
})

describe('track 客户端', () => {
  it('注册幂等：两轮注册无重复通道（诊断修复后 9 个；2026-11-09 加 reorder 通道后 10 个）', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    mod.registerExternalIpc(bags.deps)
    const channels = vi
      .mocked(ipcMain.handle)
      .mock.calls.map((call) => call[0])
      .sort()
    expect(channels).toHaveLength(10)
    expect(new Set(channels).size).toBe(10)
  })

  it('迁移在途无线四入口统一拒绝（adb 客户端会拉起 server，review P3-5）', async () => {
    const mod = await fresh()
    migrationFlag.active = true
    try {
      await expect(mod.connectWirelessDevice({ host: '1.2.3.4' })).rejects.toThrow('迁移')
      await expect(mod.scanWireless()).rejects.toThrow('迁移')
      await expect(mod.promoteToWireless({ serial: 'abc:5555' })).rejects.toThrow('迁移')
      await expect(
        mod.pairWirelessDevice({ host: '1.2.3.4', port: 5555, code: '123456' })
      ).rejects.toThrow('迁移')
    } finally {
      migrationFlag.active = false
    }
  })

  it('迁移在途不 ensure server：openSocket 只退避续排，journal 清除后自行恢复', async () => {
    const mod = await fresh()
    let migrating = true
    const { deps, ensureServer } = makeDeps({ migrationActive: () => migrating })
    mod.registerExternalIpc(deps)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ensureServer).not.toHaveBeenCalled()
    migrating = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ensureServer).toHaveBeenCalled()
    mod.stopExternalTracking()
  })

  it('list 通道：未登记 sender 抛错；已登记返回缓存', async () => {
    const mod = await fresh()
    const bags = makeDeps({ isMainSender: () => false })
    mod.registerExternalIpc(bags.deps)
    const handler = listHandler()
    expect(() => handler({ sender: {} as Electron.WebContents })).toThrow('devices:external-list')
    mod.stopExternalTracking()
    const ok = makeDeps()
    vi.mocked(ipcMain.handle).mockClear()
    mod.registerExternalIpc(ok.deps)
    expect(listHandler()({ sender: {} as Electron.WebContents })).toEqual([])
  })

  it('首帧：发长格式请求 → 解析列表 → 推主窗 + connected 事件（runId ext:serial:1）', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    expect(sock.write).toHaveBeenCalledWith(LONG_REQUEST)
    sock.emit(
      'data',
      Buffer.concat([OKAY, frameOf('A\tdevice product:p model:Pixel_6 device:d transport_id:1')])
    )
    expect(bags.onSession).toHaveBeenCalledWith({
      kind: 'connected',
      device: { id: 'A', serial: 'A', transport: 'usb', state: 'device', model: 'Pixel_6' },
      runId: 'ext:A:1'
    })
    expect(bags.broadcast).toHaveBeenCalledWith([
      { id: 'A', serial: 'A', transport: 'usb', state: 'device', model: 'Pixel_6' }
    ])
  })

  it('半包到达与重复帧：分段等价整包；相同列表不重复推送', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    const whole = Buffer.concat([OKAY, frameOf('A\tdevice model:Pixel_6')])
    sock.emit('data', whole.subarray(0, 5))
    sock.emit('data', whole.subarray(5))
    expect(bags.broadcast).toHaveBeenCalledTimes(1)
    sock.emit('data', frameOf('A\tdevice model:Pixel_6'))
    expect(bags.broadcast).toHaveBeenCalledTimes(1)
    expect(bags.onSession).toHaveBeenCalledTimes(1)
  })

  it('unauthorized 入列但不建会话；转正时建会话', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, frameOf('A\tunauthorized')]))
    expect(bags.onSession).not.toHaveBeenCalled()
    expect(bags.broadcast).toHaveBeenCalledTimes(1)
    sock.emit('data', frameOf('A\tdevice model:Pixel_6'))
    expect(bags.onSession).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'ext:A:1', kind: 'connected' })
    )
  })

  it('消失与状态迁移：removed 事件 + 推送', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice model:X\nB\tdevice')]))
    sock.emit('data', frameOf('B\toffline'))
    expect(bags.onSession).toHaveBeenCalledWith({ kind: 'removed', id: 'A' })
    expect(bags.onSession).toHaveBeenCalledWith({ kind: 'removed', id: 'B' })
    expect(bags.broadcast).toHaveBeenCalledTimes(2)
    expect(bags.broadcast).toHaveBeenLastCalledWith([
      { id: 'B', serial: 'B', transport: 'usb', state: 'offline', model: null }
    ])
  })

  it('FAIL → 退短格式立即重试；短格式列表可用（model null）', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const first = bags.sockets[0]
    first.emit('connect')
    first.emit('data', Buffer.concat([Buffer.from('FAIL'), frameOf('unknown service')]))
    await flush()
    expect(bags.sockets).toHaveLength(2)
    const second = bags.sockets[1]
    second.emit('connect')
    expect(second.write).toHaveBeenCalledWith(SHORT_REQUEST)
    second.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice')]))
    expect(bags.broadcast).toHaveBeenLastCalledWith([
      { id: 'A', serial: 'A', transport: 'usb', state: 'device', model: null }
    ])
  })

  it('短格式也 FAIL → 进退避循环', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    bags.sockets[0].emit('connect')
    bags.sockets[0].emit('data', Buffer.concat([Buffer.from('FAIL'), frameOf('no')]))
    await flush()
    bags.sockets[1].emit('connect')
    bags.sockets[1].emit('data', Buffer.concat([Buffer.from('FAIL'), frameOf('still no')]))
    await flush()
    expect(bags.sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(bags.sockets).toHaveLength(3)
  })

  it('断线退避 1s 首试；重连首帧同列表也重建会话（代次自增），退避随之归零', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const first = bags.sockets[0]
    first.emit('connect')
    first.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice model:Pixel_6')]))
    first.emit('close')
    await vi.advanceTimersByTimeAsync(999)
    expect(bags.sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(bags.sockets).toHaveLength(2)
    const second = bags.sockets[1]
    second.emit('connect')
    second.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice model:Pixel_6')]))
    expect(bags.onSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ runId: 'ext:A:2', kind: 'connected' })
    )
    // 首帧已证 server 健康（backoffStep 归零）：再次断线从 1s 重试
    second.emit('close')
    await vi.advanceTimersByTimeAsync(999)
    expect(bags.sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(bags.sockets).toHaveLength(3)
  })

  it('断线期间的消失在重连首帧结算（不泄漏会话）', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const first = bags.sockets[0]
    first.emit('connect')
    first.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice')]))
    first.emit('close')
    await vi.advanceTimersByTimeAsync(1_000)
    const second = bags.sockets[1]
    second.emit('connect')
    second.emit('data', Buffer.concat([OKAY, frameOf('')]))
    expect(bags.onSession).toHaveBeenCalledWith({ kind: 'removed', id: 'A' })
    expect(bags.broadcast).toHaveBeenLastCalledWith([])
  })

  it('握手超时（5s 无首帧）→ 销毁并退避重连', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const first = bags.sockets[0]
    first.emit('connect')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(first.destroy).toHaveBeenCalled()
    // 超时回调里新排的 1s 退避计时器落在 t=6000，需再推进一拍
    await vi.advanceTimersByTimeAsync(1_000)
    expect(bags.sockets).toHaveLength(2)
  })

  it('ensureServer 失败不 connect，退避后重试', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    bags.ensureServer.mockRejectedValueOnce(new Error('no adb'))
    mod.registerExternalIpc(bags.deps)
    await flush()
    expect(bags.sockets).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(bags.ensureServer).toHaveBeenCalledTimes(2)
    expect(bags.sockets).toHaveLength(1)
  })

  it('stopExternalTracking：断 socket、close 不再重连、不再推送', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice')]))
    mod.stopExternalTracking()
    sock.emit('close')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(bags.sockets).toHaveLength(1)
    expect(bags.broadcast).toHaveBeenCalledTimes(1)
  })

  it('externalRuntimeViews：只列 device 态，name 取 model 缺省 serial，status 适配 running', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice model:EBG_AN00\nB\tunauthorized')]))
    expect(mod.externalRuntimeViews()).toEqual([
      { id: 'A', name: 'EBG_AN00', status: 'running', serial: 'A', origin: 'external' }
    ])
  })

  it('resumeExternalSessions（review P2-1）：对 device 态条目代次自增重发 connected', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, frameOf('A\tdevice model:X\nB\tunauthorized')]))
    mod.resumeExternalSessions()
    expect(bags.onSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'connected', runId: 'ext:A:2' })
    )
    expect(bags.onSession).toHaveBeenCalledTimes(2)
    // 未注册（stopExternalTracking 后）时 no-op
    mod.stopExternalTracking()
    mod.resumeExternalSessions()
    expect(bags.onSession).toHaveBeenCalledTimes(2)
  })

  it('空首帧 nudge（review 二轮 P3-C）：1.5s 仍空重开连接一次；重开仍空不再循环', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const first = bags.sockets[0]
    first.emit('connect')
    first.emit('data', Buffer.concat([OKAY, frameOf('')]))
    await vi.advanceTimersByTimeAsync(1_499)
    expect(bags.sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(bags.sockets).toHaveLength(2)
    const second = bags.sockets[1]
    second.emit('connect')
    second.emit('data', Buffer.concat([OKAY, frameOf('')]))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(bags.sockets).toHaveLength(2)
  })

  it('空首帧后设备经推送到达：nudge 清除且闩复位，连接不重开', async () => {
    const mod = await fresh()
    const bags = makeDeps()
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, frameOf('')]))
    sock.emit('data', frameOf('A\tdevice'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(bags.sockets).toHaveLength(1)
    expect(bags.broadcast).toHaveBeenLastCalledWith([
      { id: 'A', serial: 'A', transport: 'usb', state: 'device', model: null }
    ])
  })
})

describe('真机用户序重排（plan 2026-11-09-device-list-drag-reorder）', () => {
  type ReorderHandler = (event: { sender: Electron.WebContents }, raw: unknown) => unknown
  const reorderHandler = (): ReorderHandler => {
    const call = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'devices:external-reorder')
    if (!call) throw new Error('devices:external-reorder handler not registered')
    return call[1] as never
  }
  const sender = (): { sender: Electron.WebContents } => ({ sender: {} as Electron.WebContents })

  /** 注册并推首帧建立 cache（frames 逐帧发）；fresh 后 import externalOrder 与 external 同实例 */
  const boot = async (
    frames: string[],
    overrides: Partial<ExternalDeps> = {}
  ): Promise<{
    bags: DepsBag
    order: typeof import('../externalOrder')
  }> => {
    const mod = await fresh()
    const order = await import('../externalOrder')
    const bags = makeDeps(overrides)
    mod.registerExternalIpc(bags.deps)
    await flush()
    const sock = bags.sockets[0]
    sock.emit('connect')
    sock.emit('data', Buffer.concat([OKAY, ...frames.map(frameOf)]))
    return { bags, order }
  }

  beforeEach(() => {
    fsMocks.readFile.mockRejectedValue(new Error('ENOENT'))
    fsMocks.writeFile.mockResolvedValue(undefined)
    fsMocks.rename.mockResolvedValue(undefined)
  })

  it('载荷与整单校验：非对象/缺 ids/非串/空串/重复/未知/缺项一律整单拒绝且零副作用', async () => {
    const { bags } = await boot(['A\tdevice\nB\tdevice'])
    const handler = reorderHandler()
    for (const bad of [
      null,
      'x',
      {},
      { ids: 'A' },
      { ids: [1] },
      { ids: [''] },
      { ids: ['A', 'A'] },
      { ids: ['A', 'X'] },
      { ids: ['A'] }
    ]) {
      expect(() => handler(sender(), bad)).toThrow('devices:external-reorder')
    }
    expect(bags.broadcast).toHaveBeenCalledTimes(1) // 仅首帧，拒绝路径零广播
  })

  it('未登记 sender 拒绝（对齐 devicesExternalList 守卫）', async () => {
    const { bags } = await boot(['A\tdevice'], { isMainSender: () => false })
    bags.broadcast.mockClear()
    expect(() => reorderHandler()(sender(), { ids: ['A'] })).toThrow('devices:external-reorder')
    expect(bags.broadcast).not.toHaveBeenCalled()
  })

  it('合法重排：cache 换序、广播与返回值同序、会话桥零事件；external-order.json 尽力落盘', async () => {
    const { bags } = await boot(['A\tdevice\nB\tdevice\nC\tdevice'])
    bags.onSession.mockClear()
    fsMocks.writeFile.mockClear()
    fsMocks.rename.mockClear()
    const result = reorderHandler()(sender(), { ids: ['C', 'A', 'B'] }) as never as {
      id: string
    }[]
    expect(result.map((device) => device.id)).toEqual(['C', 'A', 'B'])
    const broadcasted = bags.broadcast.mock.lastCall?.[0] as never as { id: string }[]
    expect(broadcasted.map((device) => device.id)).toEqual(['C', 'A', 'B'])
    expect(bags.onSession).not.toHaveBeenCalled()
    await flush()
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      '/userdata/external-order.json.tmp',
      expect.stringContaining('"order"'),
      'utf8'
    )
    expect(fsMocks.rename).toHaveBeenCalledWith(
      '/userdata/external-order.json.tmp',
      '/userdata/external-order.json'
    )
  })

  it('重排后 track 帧保持用户序：adb 帧序不覆盖，同一集合帧不重播', async () => {
    const { bags } = await boot(['A\tdevice\nB\tdevice\nC\tdevice'])
    reorderHandler()(sender(), { ids: ['C', 'A', 'B'] })
    const callsAfterReorder = bags.broadcast.mock.calls.length
    bags.sockets[0].emit('data', frameOf('A\tdevice\nB\tdevice\nC\tdevice'))
    // 合并后与 cache 同集合同序：sameDevices 判等，不重播
    expect(bags.broadcast.mock.calls.length).toBe(callsAfterReorder)
  })

  it('状态翻转帧保持用户序（offline/unauthorized 不冲序）', async () => {
    const { bags } = await boot(['A\tdevice\nB\tdevice\nC\tdevice'])
    reorderHandler()(sender(), { ids: ['C', 'A', 'B'] })
    bags.sockets[0].emit('data', frameOf('A\tdevice\nC\tdevice\nB\toffline'))
    const broadcasted = bags.broadcast.mock.lastCall?.[0] as never as {
      id: string
      state: string
    }[]
    expect(broadcasted.map((device) => device.id)).toEqual(['C', 'A', 'B'])
    expect(broadcasted[2]).toMatchObject({ id: 'B', state: 'offline' })
  })

  it('断线条目序位保留：拔线记忆不丢、重插回原位（帧序无关）', async () => {
    const { bags, order } = await boot(['A\tdevice\nB\tdevice'])
    reorderHandler()(sender(), { ids: ['B', 'A'] })
    bags.sockets[0].emit('data', frameOf('A\tdevice')) // B 拔线
    expect(order.orderNow()).toEqual(['B', 'A']) // 记忆保留断线 serial
    bags.sockets[0].emit('data', frameOf('A\tdevice\nB\tdevice')) // B 重插，adb 帧序 A,B
    const broadcasted = bags.broadcast.mock.lastCall?.[0] as never as { id: string }[]
    expect(broadcasted.map((device) => device.id)).toEqual(['B', 'A']) // 用户序恢复
  })
})
