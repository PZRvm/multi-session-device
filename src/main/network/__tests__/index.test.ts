// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { AdbRunResult } from '../../emulator/adb'
import {
  buildSetCommand,
  parseNetworkState,
  READ_ALL_COMMAND,
  registerNetworkIpc,
  type NetworkDeps
} from '../index'

const mocks = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn() },
  send: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }))

// msg 模板化会拉入 locale store——单测只需要稳定的键名拼串
vi.mock('../../locale', () => ({
  msg: (key: string, params?: Record<string, string | number>): string =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

const okText = (stdout: string): AdbRunResult => ({ code: 0, stdout, stderr: '' })

interface Harness {
  handlers: Map<string, (event: unknown, raw: unknown) => Promise<unknown>>
  run: ReturnType<typeof vi.fn>
  call: (channel: string, raw: unknown) => Promise<unknown>
  startWatch: (id: string, serial: string) => void
  clearWatch: (id: string) => void
}

const setup = (options?: { running?: boolean }): Harness => {
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
  mocks.ipcMain.handle.mockImplementation(
    (channel: string, handler: (event: unknown, raw: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    }
  )
  const run = vi.fn<NonNullable<NetworkDeps['run']>>(async () => okText('0\n1\n1\n'))
  const handle = registerNetworkIpc({
    adbPath: () => '/fake/adb',
    isMainSender: (sender) => (sender as { id: number }).id === 1,
    runningDevice: async () =>
      options?.running === false ? null : { serial: 'emulator-5554', name: '测试设备' },
    pushTarget: () => ({ send: mocks.send }) as unknown as Electron.WebContents,
    run
  })
  const event = { sender: { id: 1 } }
  return {
    handlers,
    run,
    call: (channel, raw) => handlers.get(channel)!(event, raw),
    startWatch: handle.startWatch,
    clearWatch: handle.clearWatch
  }
}

const rejectMessage = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected rejection')
}

describe('parseNetworkState（三行 settings 读回）', () => {
  it('0/1/1 三行 → 全布尔态', () => {
    expect(parseNetworkState('0\n1\n1\n')).toEqual({ airplane: false, wifi: true, data: true })
  })

  it('CRLF 行尾归一化', () => {
    expect(parseNetworkState('1\r\n0\r\n1\r\n')).toEqual({
      airplane: true,
      wifi: false,
      data: true
    })
  })

  it("wifi_on 的 '2'（飞行模式下推 enable 的开启中瞬态）映射为开", () => {
    expect(parseNetworkState('1\n2\n0\n')).toEqual({ airplane: true, wifi: true, data: false })
  })

  it("键未设输出 'null'（wifi-only 画像等）按该键关闭，不判整体失败（P3-A）", () => {
    expect(parseNetworkState('0\nnull\n1\n')).toEqual({ airplane: false, wifi: false, data: true })
    expect(parseNetworkState('0\n1\nnull\n')).toEqual({ airplane: false, wifi: true, data: false })
  })

  it('行数不足或垃圾值 → null', () => {
    expect(parseNetworkState('0\n1\n')).toBeNull()
    expect(parseNetworkState('')).toBeNull()
    expect(parseNetworkState('x\n1\n1\n')).toBeNull()
  })

  it('尾部空行不干扰（末尾换行产生空行被过滤）', () => {
    expect(parseNetworkState('0\n1\n1\n\n')).toEqual({ airplane: false, wifi: true, data: true })
  })
})

describe('buildSetCommand（三目标命令拼装）', () => {
  it('airplane 走 cmd connectivity（PRD 口径）；wifi/data 走 svc', () => {
    expect(buildSetCommand('airplane', true)).toBe('cmd connectivity airplane-mode enable')
    expect(buildSetCommand('airplane', false)).toBe('cmd connectivity airplane-mode disable')
    expect(buildSetCommand('wifi', true)).toBe('svc wifi enable')
    expect(buildSetCommand('wifi', false)).toBe('svc wifi disable')
    expect(buildSetCommand('data', true)).toBe('svc data enable')
    expect(buildSetCommand('data', false)).toBe('svc data disable')
  })
})

describe('networkSet 通道', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('成功：命令下发 → 立即合并读回 → 返回读回态并推送变化', async () => {
    const harness = setup()
    const result = (await harness.call(IPC_CHANNELS.networkSet, {
      id: 'd1',
      target: 'airplane',
      enabled: true
    })) as { state: { airplane: boolean; wifi: boolean; data: boolean } }
    expect(result.state).toEqual({ airplane: false, wifi: true, data: true })
    expect(harness.run).toHaveBeenCalledTimes(2)
    expect(harness.run.mock.calls[0]).toEqual([
      '/fake/adb',
      ['-s', 'emulator-5554', 'shell', 'cmd connectivity airplane-mode enable'],
      { timeoutMs: 10_000 }
    ])
    expect(harness.run.mock.calls[1]).toEqual([
      '/fake/adb',
      ['-s', 'emulator-5554', 'shell', READ_ALL_COMMAND],
      { timeoutMs: 10_000 }
    ])
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith(IPC_CHANNELS.networkChanged, {
      deviceId: 'd1',
      state: { airplane: false, wifi: true, data: true }
    })
  })

  it('命令 exit 非 0：拒绝并附 stderr 详情；不读回不推送', async () => {
    const harness = setup()
    harness.run.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'svc: boom' })
    const message = await rejectMessage(
      harness.call(IPC_CHANNELS.networkSet, { id: 'd1', target: 'wifi', enabled: false })
    )
    expect(message).toContain('networkCommandFailed')
    expect(message).toContain('svc: boom')
    expect(harness.run).toHaveBeenCalledTimes(1)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('设备未运行：拒绝 networkDeviceNotRunning，不触 adb', async () => {
    const harness = setup({ running: false })
    const message = await rejectMessage(
      harness.call(IPC_CHANNELS.networkSet, { id: 'd1', target: 'data', enabled: true })
    )
    expect(message).toBe('networkDeviceNotRunning')
    expect(harness.run).not.toHaveBeenCalled()
  })

  it('互斥：同设备命令在途时第二发直接拒绝（同步占位，零 await 间隙）', async () => {
    const harness = setup()
    let release: (() => void) | null = null
    let firstCall = true
    harness.run.mockImplementation(async () => {
      // 只挂起首 发命令；读回立即返回——否则 await first 会永远等第二个 deferred
      if (firstCall) {
        firstCall = false
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return okText('0\n1\n1\n')
    })
    const first = harness.call(IPC_CHANNELS.networkSet, {
      id: 'd1',
      target: 'airplane',
      enabled: true
    })
    const second = harness.call(IPC_CHANNELS.networkSet, {
      id: 'd1',
      target: 'wifi',
      enabled: true
    })
    expect(await rejectMessage(second)).toBe('networkBusy')
    release!()
    await first
  })

  it('载荷非法：拒绝 invalidPayload', async () => {
    const harness = setup()
    const message = await rejectMessage(harness.call(IPC_CHANNELS.networkSet, { id: 'd1' }))
    expect(message).toContain('invalidPayload')
    const message2 = await rejectMessage(
      harness.call(IPC_CHANNELS.networkSet, { id: 'd1', target: 'bluetooth', enabled: true })
    )
    expect(message2).toContain('invalidPayload')
  })

  it('非主窗 sender：拒绝 unregisteredWindowSuffix', async () => {
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    const run = vi.fn<NonNullable<NetworkDeps['run']>>(async () => okText('0\n1\n1\n'))
    registerNetworkIpc({
      adbPath: () => '/fake/adb',
      isMainSender: (sender) => (sender as { id: number }).id === 1,
      runningDevice: async () => ({ serial: 'emulator-5554', name: '测试设备' }),
      pushTarget: () => null,
      run
    })
    const message = await rejectMessage(
      handlers.get(IPC_CHANNELS.networkSet)!(
        { sender: { id: 99 } },
        { id: 'd1', target: 'wifi', enabled: true }
      )
    )
    expect(message).toContain('unregisteredWindowSuffix')
    const getMessage = await rejectMessage(
      handlers.get(IPC_CHANNELS.networkGet)!({ sender: { id: 99 } }, undefined)
    )
    expect(getMessage).toContain('unregisteredWindowSuffix')
  })

  it('networkGet：返回 lastStates 快照（renderer 刷新恢复初值，P3-1）；不触 adb', async () => {
    const harness = setup()
    expect(await harness.call(IPC_CHANNELS.networkGet, undefined)).toEqual({})
    await harness.call(IPC_CHANNELS.networkSet, { id: 'd1', target: 'wifi', enabled: false })
    harness.run.mockClear()
    const snapshot = (await harness.call(IPC_CHANNELS.networkGet, undefined)) as Record<
      string,
      { airplane: boolean; wifi: boolean; data: boolean }
    >
    expect(snapshot).toEqual({ d1: { airplane: false, wifi: true, data: true } })
    expect(harness.run).not.toHaveBeenCalled()
  })
})

describe('轮询器（startWatch/clearWatch）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('首拍立即执行（启动即得初值）；同值不重复推送', async () => {
    const harness = setup()
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.run).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    // 1s 间隔 ×5 拍：同值只有首拍推送
    expect(harness.run).toHaveBeenCalledTimes(6)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    harness.clearWatch('d1')
  })

  it('设备内切换语义：读回值变化才第二次推送', async () => {
    const harness = setup()
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(0)
    harness.run.mockResolvedValue(okText('1\n0\n0\n'))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send).toHaveBeenLastCalledWith(IPC_CHANNELS.networkChanged, {
      deviceId: 'd1',
      state: { airplane: true, wifi: false, data: false }
    })
    harness.clearWatch('d1')
  })

  it('读失败本轮放弃：不推送不告警，下轮恢复后照常比较', async () => {
    const harness = setup()
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    harness.run.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'device offline' })
    await vi.advanceTimersByTimeAsync(1_000)
    // 失败一轮：无新推送，旧值保留
    expect(mocks.send).toHaveBeenCalledTimes(1)
    harness.run.mockResolvedValue(okText('0\n1\n1\n'))
    await vi.advanceTimersByTimeAsync(1_000)
    // 恢复后同值：依旧不推（lastStates 未被失败轮破坏）
    expect(mocks.send).toHaveBeenCalledTimes(1)
    harness.clearWatch('d1')
  })

  it('在途守卫：上一拍未返回时跳过本轮，不堆积', async () => {
    const harness = setup()
    let release: (() => void) | null = null
    harness.run.mockImplementation(
      () =>
        new Promise<AdbRunResult>((resolve) => {
          release = () => resolve(okText('0\n1\n1\n'))
        })
    )
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(3_500)
    // 首拍挂起期间三个间隔触发，全部被 inFlight 跳过
    expect(harness.run).toHaveBeenCalledTimes(1)
    release!()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(harness.run).toHaveBeenCalledTimes(2)
    harness.clearWatch('d1')
  })

  it('clearWatch：timer 退订（无泄漏），读回基准清空（重启后同值也会重新推送）', async () => {
    const harness = setup()
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    harness.clearWatch('d1')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(harness.run).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    // 设备重启（stopped → running）：lastStates 已清，同值首拍重新推送
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.send).toHaveBeenCalledTimes(2)
    harness.clearWatch('d1')
  })

  it('同 id 重复 startWatch（防御分支）：不建第二个 timer，serial 就地刷新', async () => {
    const harness = setup()
    harness.startWatch('d1', 'emulator-5554')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.run).toHaveBeenCalledTimes(1)
    harness.startWatch('d1', 'emulator-5556')
    await vi.advanceTimersByTimeAsync(1_000)
    // 只有一个 timer 在跑，且后续读用新 serial
    expect(harness.run).toHaveBeenCalledTimes(2)
    expect(harness.run.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(['-s', 'emulator-5556', 'shell'])
    )
    harness.clearWatch('d1')
  })
})
