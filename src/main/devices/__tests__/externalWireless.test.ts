import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ExternalDevice } from '@shared/types'
import {
  connectWirelessDevice,
  disconnectWirelessDevice,
  isWirelessConnectInput,
  isWirelessPairInput,
  pairWirelessDevice,
  parseMdnsServices,
  promoteToWireless,
  registerExternalIpc,
  scanWireless,
  setExternalDevicesForTests,
  stopExternalTracking,
  type WirelessDeps
} from '../external'

/** 不触发任何事件的哑 socket：openSocket 挂上后停在握手期，由 stopExternalTracking 收口 */
class DormantSocket extends EventEmitter {
  destroy = vi.fn()
}

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

// 无线域测试（plan 2026-10-15-real-device-wireless）：解析纯函数 + 四函数（接缝注入，
// delay 替身消解真实等待）+ 通道装配（sender 守卫 / 载荷校验 / wireless 接缝透传）。
// 小米 mDNS 输出格式无真机可验——按 platform-tools 文档形态编码，解析器容忍变体。

interface CmdResult {
  code: number
  stdout: string
  stderr: string
}

const ok = (stdout: string): CmdResult => ({ code: 0, stdout, stderr: '' })

const makeDeps = (overrides: Partial<WirelessDeps> = {}): WirelessDeps => ({
  runCmd: vi.fn(async () => ok('')),
  probeTcp: vi.fn(async () => false),
  delay: vi.fn(async () => undefined),
  localSubnets: vi.fn(() => ['192.168.31.']),
  ...overrides
})

const callsOf = (mock: unknown): string[][] =>
  (mock as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0] as string[])

const deviceOf = (serial: string): ExternalDevice => ({
  id: serial,
  serial,
  transport: 'usb',
  state: 'device',
  model: null
})

describe('parseMdnsServices', () => {
  it('解析文档形态：表头 + 制表符分隔 + 行尾 ip:port', () => {
    const output = [
      'List of discovered mdns services',
      'adb-8123456789abcdef-EBG_AN00._adb-tls-connect._tcp.\t192.168.31.50:40123',
      'adb-7777-pixel._adb-tls-pairing._tcp.\t192.168.31.51:35001'
    ].join('\n')
    expect(parseMdnsServices(output)).toEqual([
      {
        source: 'mdns-connect',
        name: 'adb-8123456789abcdef-EBG_AN00',
        host: '192.168.31.50',
        port: 40123
      },
      { source: 'mdns-pairing', name: 'adb-7777-pixel', host: '192.168.31.51', port: 35001 }
    ])
  })

  it('实例名含空格不丢（同族教训：不按空白切整行）', () => {
    const output = 'my pixel 8 _adb-tls-connect._tcp 192.168.31.52:40124'
    expect(parseMdnsServices(output)).toEqual([
      { source: 'mdns-connect', name: 'my pixel 8', host: '192.168.31.52', port: 40124 }
    ])
  })

  it('无 ip:port 的行丢弃；无关行跳过；空输出为空表', () => {
    const output = [
      'List of discovered mdns services',
      'adb-old._adb-tls-connect._tcp\t40125',
      '_http._tcp\t192.168.31.53:80',
      ''
    ].join('\n')
    expect(parseMdnsServices(output)).toEqual([])
    expect(parseMdnsServices('')).toEqual([])
  })
})

describe('scanWireless', () => {
  it('两源合并：mDNS 候选在前，网段探活补漏，同址去重', async () => {
    const deps = makeDeps({
      runCmd: vi.fn(async () =>
        ok(
          '\tadb-abc-._adb-tls-connect._tcp.\t192.168.31.102:5555\n\tadb-pp._adb-tls-pairing._tcp.\t192.168.31.60:35001'
        )
      ),
      probeTcp: vi.fn(
        async (host: string) => host === '192.168.31.102' || host === '192.168.31.200'
      )
    })
    const found = await scanWireless(deps)
    expect(found).toEqual([
      { source: 'mdns-connect', name: 'adb-abc-', host: '192.168.31.102', port: 5555 },
      { source: 'mdns-pairing', name: 'adb-pp', host: '192.168.31.60', port: 35001 },
      { source: 'subnet-scan', name: null, host: '192.168.31.200', port: 5555 }
    ])
    // 全网段并行探活：.1—.254，5555，1s 超时
    const probes = (deps.probeTcp as ReturnType<typeof vi.fn>).mock.calls
    expect(probes).toHaveLength(254)
    expect(probes[0]).toEqual(['192.168.31.1', 5555, 1_000])
    expect(probes[101]).toEqual(['192.168.31.102', 5555, 1_000])
  })

  it('mdns daemon 不可用 → 该源静默空（手动输入一等入口，不是降级）', async () => {
    const deps = makeDeps({
      runCmd: vi.fn(async () => {
        throw new Error('mdns daemon not running')
      }),
      probeTcp: vi.fn(async (host: string) => host === '192.168.31.9')
    })
    expect(await scanWireless(deps)).toEqual([
      { source: 'subnet-scan', name: null, host: '192.168.31.9', port: 5555 }
    ])
  })
})

describe('connectWirelessDevice', () => {
  const CONNECTED = ok('connected to 192.168.31.102:5555')
  const devicesWith = (state: string): CmdResult =>
    ok(`List of devices attached\n192.168.31.102:5555\t${state}\n`)

  it('connected + device 态即成功，端口缺省 5555，无退避', async () => {
    const deps = makeDeps({
      runCmd: vi.fn(async (args: string[]) =>
        args[0] === 'connect' ? CONNECTED : devicesWith('device')
      )
    })
    const outcome = await connectWirelessDevice({ host: '192.168.31.102' }, deps)
    expect(outcome).toEqual({ ok: true, serial: '192.168.31.102:5555' })
    expect(callsOf(deps.runCmd)[0]).toEqual(['connect', '192.168.31.102:5555'])
    expect(deps.delay).not.toHaveBeenCalled()
  })

  it('offline 竞态：退避一拍后恢复 → 成功且 delay(1000)', async () => {
    let devicesCalls = 0
    const deps = makeDeps({
      runCmd: vi.fn(async (args: string[]) => {
        if (args[0] === 'connect') return CONNECTED
        devicesCalls += 1
        return devicesWith(devicesCalls === 1 ? 'offline' : 'device')
      })
    })
    expect(await connectWirelessDevice({ host: '192.168.31.102' }, deps)).toEqual({
      ok: true,
      serial: '192.168.31.102:5555'
    })
    expect(deps.delay).toHaveBeenCalledWith(1_000)
  })

  it('offline 耗尽全部退避 → offline-race（1/2/4/8/16s 五拍）', async () => {
    const deps = makeDeps({
      runCmd: vi.fn(async (args: string[]) =>
        args[0] === 'connect' ? CONNECTED : devicesWith('offline')
      )
    })
    expect(await connectWirelessDevice({ host: '192.168.31.102' }, deps)).toEqual({
      ok: false,
      reason: 'offline-race',
      host: '192.168.31.102'
    })
    expect((deps.delay as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000
    ])
    expect(callsOf(deps.runCmd).filter((args) => args[0] === 'connect')).toHaveLength(6)
  })

  it('TCP 层失败同网段 → unreachable；跨网段 → cross-subnet（不退避）', async () => {
    const failed = ok("failed to connect to '192.168.31.102:5555': Operation timed out")
    const same = makeDeps({ runCmd: vi.fn(async () => failed) })
    expect(await connectWirelessDevice({ host: '192.168.31.102' }, same)).toEqual({
      ok: false,
      reason: 'unreachable',
      host: '192.168.31.102'
    })
    const away = makeDeps({ runCmd: vi.fn(async () => failed), localSubnets: () => [] })
    expect(await connectWirelessDevice({ host: '192.168.0.108' }, away)).toEqual({
      ok: false,
      reason: 'cross-subnet',
      host: '192.168.0.108'
    })
    expect(away.delay).not.toHaveBeenCalled()
  })

  it('unauthorized 即时失败——重试不会让用户去手机上点授权变快', async () => {
    const deps = makeDeps({
      runCmd: vi.fn(async (args: string[]) =>
        args[0] === 'connect' ? CONNECTED : devicesWith('unauthorized')
      )
    })
    expect(await connectWirelessDevice({ host: '192.168.31.102' }, deps)).toEqual({
      ok: false,
      reason: 'unauthorized',
      host: '192.168.31.102'
    })
    expect(deps.delay).not.toHaveBeenCalled()
  })
})

describe('promoteToWireless', () => {
  afterEach(() => setExternalDevicesForTests([]))

  it('device 态 USB 设备：读 wlan0 IP → tcpip 5555 → connect 成功', async () => {
    setExternalDevicesForTests([deviceOf('DSLDU20B12002637')])
    const route = ok(
      'default via 192.168.31.1 dev wlan0 proto dhcp src 192.168.31.102 metric 600\n'
    )
    const deps = makeDeps({
      runCmd: vi.fn(async (args: string[]) => {
        if (args.includes('route')) return route
        if (args.includes('tcpip')) return ok('restarting in TCP mode port: 5555')
        if (args[0] === 'connect') return ok('connected to 192.168.31.102:5555')
        return ok('List of devices attached\n192.168.31.102:5555\tdevice\n')
      })
    })
    expect(await promoteToWireless({ serial: 'DSLDU20B12002637' }, deps)).toEqual({
      ok: true,
      serial: '192.168.31.102:5555'
    })
    const calls = callsOf(deps.runCmd)
    expect(calls[0]).toEqual(['-s', 'DSLDU20B12002637', 'shell', 'ip', 'route'])
    expect(calls[1]).toEqual(['-s', 'DSLDU20B12002637', 'tcpip', '5555'])
    expect(calls[2]).toEqual(['connect', '192.168.31.102:5555'])
  })

  it('无 wlan0（手机未连 Wi-Fi）→ no-wifi，且不下发 tcpip', async () => {
    setExternalDevicesForTests([deviceOf('S')])
    const deps = makeDeps({
      runCmd: vi.fn(async () => ok('default via 10.0.0.1 dev rmnet_data0 src 10.1.2.3\n'))
    })
    expect(await promoteToWireless({ serial: 'S' }, deps)).toEqual({
      ok: false,
      reason: 'no-wifi',
      host: 'S'
    })
    expect(deps.runCmd).toHaveBeenCalledTimes(1)
  })

  it('serial 不在缓存或非 device 态 → not-found，零命令', async () => {
    setExternalDevicesForTests([])
    const deps = makeDeps()
    expect(await promoteToWireless({ serial: 'GONE' }, deps)).toEqual({
      ok: false,
      reason: 'not-found',
      host: 'GONE'
    })
    expect(deps.runCmd).not.toHaveBeenCalled()
  })
})

describe('pairWirelessDevice / disconnectWirelessDevice', () => {
  it('配对成功按输出判定；失败回传 adb 原文', async () => {
    const good = makeDeps({
      runCmd: vi.fn(async () => ok('Successfully paired to 192.168.31.50:40123'))
    })
    expect(
      await pairWirelessDevice({ host: '192.168.31.50', port: 40123, code: ' 123456 ' }, good)
    ).toEqual({ ok: true })
    expect(callsOf(good.runCmd)[0]).toEqual(['pair', '192.168.31.50:40123', '123456'])
    const bad = makeDeps({
      runCmd: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'Failed: wrong code' }))
    })
    expect(
      await pairWirelessDevice({ host: '192.168.31.50', port: 40123, code: '000000' }, bad)
    ).toEqual({
      ok: false,
      message: 'Failed: wrong code'
    })
  })

  it('断开直发 disconnect serial', async () => {
    const deps = makeDeps()
    await disconnectWirelessDevice('192.168.31.102:5555', deps)
    expect(callsOf(deps.runCmd)[0]).toEqual(['disconnect', '192.168.31.102:5555'])
  })
})

describe('载荷校验', () => {
  it('connect：点分 IPv4 + 可选端口 1–65535', () => {
    expect(isWirelessConnectInput({ host: '192.168.31.102' })).toBe(true)
    expect(isWirelessConnectInput({ host: '192.168.31.102', port: 5555 })).toBe(true)
    expect(isWirelessConnectInput({ host: 'foo' })).toBe(false)
    expect(isWirelessConnectInput({ host: '192.168.31.102', port: 0 })).toBe(false)
    expect(isWirelessConnectInput({ host: '192.168.31.102', port: 70_000 })).toBe(false)
    expect(isWirelessConnectInput(null)).toBe(false)
  })

  it('pair：三字段齐备，配对码非空短串', () => {
    expect(isWirelessPairInput({ host: '192.168.31.50', port: 40123, code: '123456' })).toBe(true)
    expect(isWirelessPairInput({ host: '192.168.31.50', port: 40123, code: ' ' })).toBe(false)
    expect(isWirelessPairInput({ host: '192.168.31.50', port: 40123, code: 'x'.repeat(17) })).toBe(
      false
    )
    expect(isWirelessPairInput({ host: '192.168.31.50', code: '123456' })).toBe(false)
  })
})

describe('无线通道装配', () => {
  type Handler = (event: { sender: unknown }, raw?: unknown) => unknown
  const handlers = new Map<string, Handler>()

  beforeEach(() => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockImplementation(((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }) as typeof ipcMain.handle)
  })
  afterEach(() => stopExternalTracking())

  const wire = (wireless: Partial<WirelessDeps>, isMainSender = true): void => {
    registerExternalIpc({
      isMainSender: () => isMainSender,
      ensureServer: async () => ({}),
      connect: () => new DormantSocket() as never,
      wireless
    })
  }

  it('scan：接缝透传 + sender 守卫', async () => {
    wire(
      makeDeps({
        runCmd: vi.fn(async () => ok('adb-x._adb-tls-connect._tcp 192.168.31.7:5555'))
      })
    )
    const scan = handlers.get(IPC_CHANNELS.devicesExternalScan) as Handler
    await expect(scan({ sender: {} })).resolves.toEqual([
      { source: 'mdns-connect', name: 'adb-x', host: '192.168.31.7', port: 5555 }
    ])
  })

  it('非主窗 sender → unregisteredWindowSuffix', () => {
    wire(makeDeps(), false)
    const scan = handlers.get(IPC_CHANNELS.devicesExternalScan) as Handler
    expect(() => scan({ sender: {} })).toThrow(/devices:external-scan/)
  })

  it('connect 载荷非法 → invalidPayload；合法 → outcome 直达', async () => {
    wire(
      makeDeps({
        runCmd: vi.fn(async (args: string[]) =>
          args[0] === 'connect'
            ? ok('connected to 10.0.0.9:5555')
            : ok('List of devices attached\n10.0.0.9:5555\tdevice\n')
        )
      })
    )
    const connect = handlers.get(IPC_CHANNELS.devicesExternalConnect) as Handler
    expect(() => connect({ sender: {} }, { host: 'nope' })).toThrow(/非法的入参/)
    await expect(connect({ sender: {} }, { host: '10.0.0.9' })).resolves.toEqual({
      ok: true,
      serial: '10.0.0.9:5555'
    })
  })

  it('promote 与 disconnect 通道各自绑定', async () => {
    setExternalDevicesForTests([deviceOf('S1')])
    wire(
      makeDeps({
        runCmd: vi.fn(async (args: string[]) => {
          if (args.includes('route'))
            return ok('default via 192.168.31.1 dev wlan0 src 192.168.31.9\n')
          if (args[0] === 'connect') return ok('connected to 192.168.31.9:5555')
          return ok('List of devices attached\n192.168.31.9:5555\tdevice\n')
        })
      })
    )
    const promote = handlers.get(IPC_CHANNELS.devicesExternalPromote) as Handler
    await expect(promote({ sender: {} }, { serial: 'S1' })).resolves.toEqual({
      ok: true,
      serial: '192.168.31.9:5555'
    })
    const disconnect = handlers.get(IPC_CHANNELS.devicesExternalDisconnect) as Handler
    await expect(
      disconnect({ sender: {} }, { serial: '192.168.31.9:5555' })
    ).resolves.toBeUndefined()
    setExternalDevicesForTests([])
  })
})
