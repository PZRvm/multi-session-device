// @vitest-environment node
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { Device, LogcatBatchMessage } from '@shared/types'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  spawn: vi.fn(),
  msg: vi.fn((key: string) => key)
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, BrowserWindow: {} }))
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => mocks.spawn(...args) }))
vi.mock('../../locale', () => ({ msg: mocks.msg }))

type LogcatManager = Awaited<ReturnType<typeof import('../index').createLogcatManager>>

class FakePipe extends EventEmitter {
  setEncoding = vi.fn()
}

class FakeChild extends EventEmitter {
  stdout = new FakePipe()
  stderr = new FakePipe()
  exitCode: number | null = null
  signalCode: string | null = null
  kill = vi.fn((signal?: string): boolean => {
    if (signal === 'SIGKILL') return true
    this.exitCode = 0
    this.emit('exit', 0, null)
    return true
  })
}

interface FakeContents {
  id: number
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  once: ReturnType<typeof vi.fn>
  destroy: () => void
}

const makeContents = (id: number): FakeContents => {
  let destroyed = false
  return {
    id,
    send: vi.fn(),
    isDestroyed: () => destroyed,
    once: vi.fn(),
    destroy: (): void => {
      destroyed = true
    }
  }
}

const asWebContents = (contents: FakeContents): WebContents => contents as unknown as WebContents

const deviceOf = (id: string, status: Device['status'], serial?: string, runId?: string): Device =>
  ({ id, name: id, status, serial, runId }) as unknown as Device

const batchesOf = (contents: FakeContents): LogcatBatchMessage[] =>
  contents.send.mock.calls
    .filter((call) => call[0] === 'logcat:batch')
    .map((call) => call[1] as LogcatBatchMessage)

describe('日志域会话与流控', () => {
  let children: FakeChild[]
  let contentsA: FakeContents
  let contentsB: FakeContents

  const makeManager = async (devices: Device[]): Promise<LogcatManager> => {
    const { createLogcatManager } = await import('../index')
    return createLogcatManager({
      adbPath: () => '/fake/adb',
      toolEnv: () => ({ ANDROID_SDK_ROOT: '/sdk' }),
      runtimeViews: () =>
        devices.map((device) => ({
          id: device.id,
          name: device.name,
          status: device.status,
          serial: device.serial,
          runId: device.runId
        })),
      isLogcatWindow: (sender) => sender.id === 99
    })
  }

  const handlerOf = (channel: string): ((event: unknown, raw: unknown) => unknown) => {
    // 取最近一次注册（同一测试里两个 manager 各注册一遍时，后者覆盖语义）
    const call = [...mocks.handle.mock.calls].reverse().find(([name]) => name === channel)
    if (!call) throw new Error(`handler 未注册：${channel}`)
    return call[1] as (event: unknown, raw: unknown) => unknown
  }

  const subscribe = async (
    manager: LogcatManager,
    contents: FakeContents,
    deviceId: string
  ): Promise<void> => {
    manager.registerIpc()
    await handlerOf('logcat:subscribe')({ sender: asWebContents(contents) }, { deviceId })
  }

  const pushLines = (lines: string[]): void => {
    const child = children[children.length - 1]
    child.stdout.emit('data', `${lines.join('\n')}\n`)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // 模块级 sessions 状态不跨测试——每测试重建模块实例
    vi.resetModules()
    children = []
    mocks.spawn.mockImplementation(() => {
      const child = new FakeChild()
      children.push(child)
      return child
    })
    contentsA = makeContents(1)
    contentsB = makeContents(2)
  })

  it('ensureSession 以 serial 起 adb logcat；重复 ensure 同 runId 不另起进程', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 'emulator-5554', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 'emulator-5554' })
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 'emulator-5554' })
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/fake/adb',
      ['-s', 'emulator-5554', 'logcat'],
      expect.objectContaining({ env: expect.objectContaining({ ANDROID_SDK_ROOT: '/sdk' }) })
    )
  })

  it('订阅回放缓冲尾（replay），实时行攒满阈值即批量推送', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 'emulator-5554', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 'emulator-5554' })
    pushLines(['a1', 'a2'])
    await subscribe(manager, contentsA, 'd1')
    const replay = batchesOf(contentsA)[0]
    expect(replay.replay).toBe(true)
    expect(replay.lines.map((line) => line.text)).toEqual(['a1', 'a2'])
    // 订阅后仅一个回放包（pending 中的行已在缓冲尾，不重复补发）
    expect(batchesOf(contentsA)).toHaveLength(1)
    // 200 行阈值触发即时 flush（不经定时器）
    pushLines(Array.from({ length: 200 }, (_, i) => `b${i}`))
    const live = batchesOf(contentsA).at(-1)!
    expect(live.replay).toBe(false)
    expect(live.lines).toHaveLength(200)
    expect(live.lines[0].text).toBe('b0')
  })

  it('250ms flush 定时器把攒批中的行发出', async () => {
    vi.useFakeTimers()
    try {
      const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
      manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 's1' })
      await subscribe(manager, contentsA, 'd1')
      // 订阅时缓冲为空：回放包（0 行）不发送，批次从实时行开始
      expect(batchesOf(contentsA)).toHaveLength(0)
      pushLines(['slow-1'])
      expect(batchesOf(contentsA)).toHaveLength(0)
      vi.advanceTimersByTime(250)
      expect(batchesOf(contentsA)).toHaveLength(1)
      expect(batchesOf(contentsA)[0].lines.map((line) => line.text)).toEqual(['slow-1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('订阅未运行设备被拒；同一会话向多窗口分别推送', async () => {
    const manager = await makeManager([deviceOf('d1', 'stopped')])
    manager.registerIpc()
    expect(() =>
      handlerOf('logcat:subscribe')({ sender: asWebContents(contentsA) }, { deviceId: 'd1' })
    ).toThrow('logcatDeviceNotRunning')

    const manager2 = await makeManager([deviceOf('d2', 'running', 's2', 'run-2')])
    manager2.ensureSession({ id: 'd2', runId: 'run-2', serial: 's2' })
    await subscribe(manager2, contentsA, 'd2')
    await subscribe(manager2, contentsB, 'd2')
    pushLines(['x'])
    pushLines(Array.from({ length: 200 }, (_, i) => `y${i}`))
    expect(batchesOf(contentsA).some((b) => b.lines.some((l) => l.text === 'x'))).toBe(true)
    expect(batchesOf(contentsB).some((b) => b.lines.some((l) => l.text === 'x'))).toBe(true)
  })

  it('未 ack 积压超限丢最旧保最新（dropped 计数），ack 后恢复满批', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 's1' })
    await subscribe(manager, contentsA, 'd1')
    // 2200 行全部未确认：超过 BACKLOG_LIMIT(2000) 的部分按批丢弃并计数
    pushLines(Array.from({ length: 2200 }, (_, i) => `l${i}`))
    const batches = batchesOf(contentsA)
    const totalSent = batches.reduce((sum, b) => sum + b.lines.length, 0)
    const totalDropped = batches.reduce((sum, b) => sum + b.dropped, 0)
    expect(totalSent).toBe(2000)
    expect(totalDropped).toBe(200)

    // ack 到已发送的最大 seq：积压清零，后续批次不再丢
    const lastWithLines = [...batches].reverse().find((b) => b.lines.length > 0)!
    const upToSeq = lastWithLines.lines[lastWithLines.lines.length - 1].seq
    await handlerOf('logcat:ack')({ sender: asWebContents(contentsA) }, { deviceId: 'd1', upToSeq })
    pushLines(Array.from({ length: 200 }, (_, i) => `m${i}`))
    const after = batchesOf(contentsA).at(-1)!
    expect(after.dropped).toBe(0)
    expect(after.lines).toHaveLength(200)
  })

  it('ack 只确认到 upToSeq 的批次——其余仍计积压', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 's1' })
    await subscribe(manager, contentsA, 'd1')
    pushLines(Array.from({ length: 400 }, (_, i) => `a${i}`))
    const first = batchesOf(contentsA)[0]
    await handlerOf('logcat:ack')(
      { sender: asWebContents(contentsA) },
      { deviceId: 'd1', upToSeq: first.lines[first.lines.length - 1].seq }
    )
    // 只确认了第一批 200 行，第二批仍在积压：再推 2200 行必然触达丢最旧
    pushLines(Array.from({ length: 2200 }, (_, i) => `b${i}`))
    const batches = batchesOf(contentsA).slice(2)
    const sent = batches.reduce((sum, b) => sum + b.lines.length, 0)
    expect(sent).toBeLessThan(2200)
    expect(batches.some((b) => b.dropped > 0)).toBe(true)
  })

  it('destroySession 杀进程并停推；runId 变化销毁旧会话另起新进程', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 's1' })
    await subscribe(manager, contentsA, 'd1')
    pushLines(['before'])
    await manager.destroySession('d1')
    const dead = children[0]
    expect(dead.kill).toHaveBeenCalledWith('SIGTERM')
    const sendsBefore = contentsA.send.mock.calls.length
    dead.stdout.emit('data', 'after-kill\n')
    expect(contentsA.send.mock.calls.length).toBe(sendsBefore)

    manager.ensureSession({ id: 'd1', runId: 'run-9', serial: 's1' })
    expect(children).toHaveLength(2)
    expect(children[0].kill).toHaveBeenCalled()
    // 新会话的回放重新建立视图（推入新行后订阅可见）
    pushLines(['fresh'])
    await subscribe(manager, contentsA, 'd1')
    const replay = batchesOf(contentsA).at(-1)!
    expect(replay.replay).toBe(true)
    expect(replay.lines.map((line) => line.text)).toEqual(['fresh'])
  })

  it('旧进程 exit 迟到不误杀换代后的新会话', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 's1' })
    await subscribe(manager, contentsA, 'd1')
    // 换代：旧会话连订阅一起销毁（renderer 按 runId 重挂自动重订），另起新进程
    manager.ensureSession({ id: 'd1', runId: 'run-2', serial: 's1' })
    pushLines(['fresh2'])
    await subscribe(manager, contentsA, 'd1')
    // 旧进程的 exit 事件此刻才迟到到达——不得影响新会话的推送
    children[0].emit('exit', 0, null)
    pushLines(Array.from({ length: 200 }, (_, i) => `n${i}`))
    const batches = batchesOf(contentsA).filter((b) => !b.replay)
    expect(batches.length).toBeGreaterThan(0)
    expect(batches.at(-1)!.runId).toBe('run-2')
  })

  it('webContents 销毁后不再发送（关窗自动退订效果）', async () => {
    const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
    manager.ensureSession({ id: 'd1', runId: 'run-1', serial: 's1' })
    pushLines(['seed'])
    await subscribe(manager, contentsA, 'd1')
    expect(batchesOf(contentsA)).toHaveLength(1) // 订阅回放
    contentsA.destroy()
    pushLines(Array.from({ length: 200 }, (_, i) => `z${i}`))
    expect(batchesOf(contentsA)).toHaveLength(1) // 不再推送
  })

  it('logcatContext 仅日志窗可调', async () => {
    const manager = await makeManager([deviceOf('d1', 'stopped')])
    manager.registerIpc()
    expect(() =>
      handlerOf('logcat:context')({ sender: asWebContents(contentsA) }, undefined)
    ).toThrow('logcatWindowOnlySuffix')
    const logcatWindow = makeContents(99)
    const views = handlerOf('logcat:context')(
      { sender: asWebContents(logcatWindow) },
      undefined
    ) as Array<{ id: string }>
    expect(views).toHaveLength(1)
    expect(views[0].id).toBe('d1')
  })

  it('spawn 同步失败：订阅显式报错（不再静默空态）', async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory, adb')
    })
    const manager = await makeManager([deviceOf('d1', 'running', 's1', 'run-1')])
    manager.registerIpc()
    expect(() =>
      handlerOf('logcat:subscribe')({ sender: asWebContents(contentsA) }, { deviceId: 'd1' })
    ).toThrow('logcatSpawnFailed')
  })

  it('非法载荷被拒', async () => {
    const manager = await makeManager([])
    manager.registerIpc()
    expect(() =>
      handlerOf('logcat:subscribe')({ sender: asWebContents(contentsA) }, { deviceId: '' })
    ).toThrow('logcatInvalidPayloadSuffix')
    expect(() =>
      handlerOf('logcat:ack')(
        { sender: asWebContents(contentsA) },
        { deviceId: 'd1', upToSeq: 'x' }
      )
    ).toThrow('logcatInvalidPayloadSuffix')
  })
})
