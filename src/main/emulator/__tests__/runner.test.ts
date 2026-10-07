// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOOT_INTERVAL_MS,
  BOOT_TIMEOUT_MS,
  EmulatorRunner,
  KILL_GRACE_MS,
  TERM_GRACE_MS,
  stderrTailText,
  type RunnerDeps
} from '../runner'
import { PortAllocator } from '../ports'

/** fake qemu 子进程：kill 行为可配置（SIGTERM 即死 / 仅 SIGKILL 死 / 拒不死） */
class FakeChild extends EventEmitter {
  pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  kills: NodeJS.Signals[] = []
  dieOn: 'SIGTERM' | 'SIGKILL' | 'never' = 'SIGTERM'
  options?: SpawnOptions
  spawnargs: string[] = []

  constructor() {
    super()
    this.kill = this.kill.bind(this)
  }

  kill = (signal: NodeJS.Signals): boolean => {
    this.kills.push(signal)
    if (this.dieOn === signal || (this.dieOn === 'SIGKILL' && signal === 'SIGKILL')) {
      // 异步 close，贴近真实进程退出时序
      setTimeout(() => this.close(null, signal), 0)
    }
    return true
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    if (code === null) this.signalCode = signal
    else this.exitCode = code
    this.emit('close', code, signal)
  }
}

const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => resolve(), ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true }
    )
  })

type Harness = ReturnType<typeof makeRunner>

const makeRunner = (
  overrides: Partial<RunnerDeps> = {}
): {
  runner: EmulatorRunner
  deps: RunnerDeps
  children: FakeChild[]
  events: {
    running: ReturnType<typeof vi.fn>
    unexpectedExit: ReturnType<typeof vi.fn>
    beforeKill: ReturnType<typeof vi.fn>
  }
} => {
  const children: FakeChild[] = []
  const events = {
    running: vi.fn(),
    unexpectedExit: vi.fn(),
    beforeKill: vi.fn(async () => {})
  }
  const deps: RunnerDeps = {
    sdkRoot: () => '/sdk',
    avdHome: () => '/avd',
    emulatorPath: () => '/sdk/emulator/emulator',
    adbPath: () => '/adb',
    ports: new PortAllocator({ probeTcp: async () => false, adbSerials: async () => new Set() }),
    ensureAdbServer: async () => {},
    bootProbe: vi.fn(async () => false),
    adbSerials: async () => new Set(),
    spawnEmulator: ((_path: string, args: string[], options: SpawnOptions) => {
      const child = new FakeChild()
      child.spawnargs = args
      child.options = options
      children.push(child)
      return child as unknown as ChildProcess
    }) as RunnerDeps['spawnEmulator'],
    sleep: abortableSleep,
    now: () => Date.now(),
    confirmedPortConflict: async () => false,
    onRunning: events.running,
    onUnexpectedExit: events.unexpectedExit,
    beforeKill: events.beforeKill,
    ...overrides
  }
  return { runner: new EmulatorRunner(deps), deps, children, events }
}

/** spawn 后的 boot 轮询在定时器上——统一推进 + 冲刷微任务 */
const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  // process.kill(-pid) 落到 fake child.kill 的兜底分支，行为确定
  vi.spyOn(process, 'kill').mockImplementation((() => {
    throw new Error('ESRCH')
  }) as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('EmulatorRunner 启动', () => {
  it('准备阶段立即登记，重复 start 共用准备及同一代次', async () => {
    let ready = (): void => {}
    const ensureAdbServer = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve
        })
    )
    const { runner, children } = makeRunner({ ensureAdbServer })
    const first = runner.start('d1')
    const second = runner.start('d1')
    expect(runner.phaseOf('d1')).toBe('starting')
    expect(runner.activeIds()).toEqual(['d1'])
    await tick()
    expect(ensureAdbServer).toHaveBeenCalledTimes(1)
    ready()
    expect(await second).toEqual(await first)
    expect(children).toHaveLength(1)
  })

  it('准备失败清掉登记及端口，允许重新启动', async () => {
    const adbSerials = vi
      .fn<RunnerDeps['adbSerials']>()
      .mockRejectedValueOnce(new Error('adb failed'))
      .mockResolvedValue(new Set())
    const { runner, deps, children } = makeRunner({ adbSerials })
    await expect(runner.start('d1')).rejects.toThrow('adb failed')
    expect(runner.activeIds()).toEqual([])
    expect(deps.ports.reservedOf('d1')).toBeUndefined()
    expect((await runner.start('d1')).serial).toBe('emulator-5554')
    expect(children).toHaveLength(1)
  })

  it('start 接纳即返回（不等 boot）：spawn 参数/env/进程组就位', async () => {
    const { runner, children } = makeRunner({ bootProbe: async () => true })
    const accepted = await runner.start('d1')
    expect(accepted.serial).toBe('emulator-5554')
    expect(children).toHaveLength(1)
    expect(children[0].spawnargs).toEqual(
      expect.arrayContaining(['-avd', 'd1', '-no-snapshot', '-gpu', 'host', '-port', '5554'])
    )
    const options = children[0].options
    expect(options?.detached).toBe(true)
    expect((options?.env as Record<string, string>)['ANDROID_AVD_HOME']).toBe('/avd')
    expect(runner.phaseOf('d1')).toBe('starting')
    await tick()
    expect(runner.phaseOf('d1')).toBe('running')
    expect(accepted.runId).toBeTruthy()
  })

  it('boot 完成 → onRunning（runId/serial），phase running', async () => {
    const { runner, events } = makeRunner({ bootProbe: async () => true })
    const { runId } = await runner.start('d1')
    await tick()
    expect(events.running).toHaveBeenCalledWith('d1', runId, 'emulator-5554')
    expect(runner.phaseOf('d1')).toBe('running')
  })

  it('starting/running 重复 start 幂等：同 runId，不重复 spawn', async () => {
    const { runner, children } = makeRunner({ bootProbe: async () => true })
    const first = await runner.start('d1')
    const second = await runner.start('d1')
    expect(second.runId).toBe(first.runId)
    await tick()
    const third = await runner.start('d1')
    expect(third.runId).toBe(first.runId)
    expect(children).toHaveLength(1)
  })

  it('外部 serial 残留占用 → 拒绝启动且释放端口预留', async () => {
    const { runner, deps, children } = makeRunner({
      adbSerials: async () => new Set(['emulator-5554'])
    })
    await expect(runner.start('d1')).rejects.toThrow('已被占用')
    expect(children).toHaveLength(0)
    expect(deps.ports.reservedOf('d1')).toBeUndefined()
  })
})

describe('EmulatorRunner 取消', () => {
  it('ADB 准备等待中可立即取消，迟到拒绝不再 spawn，新启动可用', async () => {
    let fail: (error: Error) => void = () => {}
    const ensureAdbServer = vi
      .fn<RunnerDeps['ensureAdbServer']>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject
          })
      )
      .mockResolvedValue(undefined)
    const { runner, children, events } = makeRunner({ ensureAdbServer })
    const result = runner.start('d1')
    const rejected = expect(result).rejects.toThrow('启动已取消')
    await tick()
    await runner.cancelStart('d1')
    await rejected
    expect(runner.activeIds()).toEqual([])
    await runner.start('d1')
    fail(new Error('late adb failure'))
    await tick()
    expect(children).toHaveLength(1)
    expect(events.unexpectedExit).not.toHaveBeenCalled()
  })

  it('已预留端口、serial 复核等待中取消：释放预留，迟到成功不启动', async () => {
    let ready: (serials: Set<string>) => void = () => {}
    const { runner, deps, children } = makeRunner({
      adbSerials: () =>
        new Promise<Set<string>>((resolve) => {
          ready = resolve
        })
    })
    const result = runner.start('d1')
    const rejected = expect(result).rejects.toThrow('启动已取消')
    await tick()
    expect(deps.ports.reservedOf('d1')).toBe(5554)
    await runner.cancelStart('d1')
    await rejected
    expect(deps.ports.reservedOf('d1')).toBeUndefined()
    ready(new Set())
    await tick()
    expect(children).toHaveLength(0)
    expect(runner.phaseOf('d1')).toBeNull()
  })

  it('退出清理也中止尚未完成的准备，迟到结果无实例', async () => {
    let ready = (): void => {}
    const { runner, children } = makeRunner({
      ensureAdbServer: () =>
        new Promise<void>((resolve) => {
          ready = resolve
        })
    })
    const result = runner.start('d1')
    const rejected = expect(result).rejects.toThrow('启动已取消')
    await tick()
    expect(await runner.disposeAll()).toEqual([])
    await rejected
    ready()
    await tick()
    expect(children).toHaveLength(0)
    await expect(runner.start('d2')).rejects.toThrow('暂停启动')
  })

  it('启动中取消：撤销启动并整组终止；迟到的 boot 成功不回写', async () => {
    let probeCalls = 0
    const { runner, children, events } = makeRunner({
      bootProbe: vi.fn(async () => {
        probeCalls += 1
        return false
      })
    })
    await runner.start('d1')
    await tick()
    const cancelPromise = runner.cancelStart('d1')
    await tick()
    expect(children[0].kills).toContain('SIGTERM')
    await cancelPromise
    expect(runner.phaseOf('d1')).toBeNull()

    // 迟到 boot：probe 后续返回 true 也不改状态
    expect(probeCalls).toBeGreaterThan(0)
    await tick(BOOT_TIMEOUT_MS + BOOT_INTERVAL_MS)
    expect(events.running).not.toHaveBeenCalled()
  })

  it('running 时取消 → 状态冲突（不能把迟到取消当停止）', async () => {
    const { runner } = makeRunner({ bootProbe: async () => true })
    await runner.start('d1')
    await tick()
    await expect(runner.cancelStart('d1')).rejects.toThrow('取消不再适用')
  })

  it('starting 时 stop → 指引走取消', async () => {
    const { runner } = makeRunner()
    await runner.start('d1')
    await tick(0)
    await expect(runner.stop('d1')).rejects.toThrow('取消启动')
  })
})

describe('EmulatorRunner 失败收口', () => {
  it('boot 期间崩溃（提前退出）→ 携带退出码与 stderr 尾巴回写', async () => {
    const { runner, children, events } = makeRunner()
    await runner.start('d1')
    await tick()
    children[0].stderr.emit('data', Buffer.from('PANIC: gpu failure'))
    children[0].close(1)
    await tick()
    expect(events.unexpectedExit).toHaveBeenCalledTimes(1)
    const info = events.unexpectedExit.mock.calls[0][2] as { code: number; stderrTail: string }
    expect(info.code).toBe(1)
    expect(info.stderrTail).toContain('PANIC')
    expect(runner.phaseOf('d1')).toBeNull()
  })

  it('boot 超时 → 回写错误且进程被整组终止', async () => {
    const { runner, children, events } = makeRunner()
    await runner.start('d1')
    await tick(BOOT_TIMEOUT_MS + 2_000)
    expect(events.unexpectedExit).toHaveBeenCalledTimes(1)
    const info = events.unexpectedExit.mock.calls[0][2] as { stderrTail: string }
    expect(info.stderrTail).toContain('启动超时')
    expect(children[0].kills).toContain('SIGTERM')
    expect(runner.phaseOf('d1')).toBeNull()
  })

  it('确认端口冲突 → 换下一对端口重试一次并成功', async () => {
    // 外部占用在首次分配之后才出现（竞态窗口语义）
    let externalTookPort = false
    const { runner, children, events, deps } = makeRunner({
      bootProbe: vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
      confirmedPortConflict: async () => true,
      ports: new PortAllocator({
        probeTcp: async (port) => externalTookPort && port === 5554,
        adbSerials: async () => new Set()
      })
    })
    const accepted = await runner.start('d1')
    expect(accepted.serial).toBe('emulator-5554')
    await tick()
    externalTookPort = true
    children[0].close(1) // 端口被抢的典型表现：秒退
    await tick()
    expect(children).toHaveLength(2)
    expect(children[1].spawnargs).toContain('5556')
    expect(runner.phaseOf('d1')).toBe('running')
    expect(events.running).toHaveBeenCalledWith('d1', accepted.runId, 'emulator-5556')
    expect(deps.ports.reservedOf('d1')).toBe(5556)
  })

  it('非端口冲突失败不重试', async () => {
    const { runner, children, events } = makeRunner({ confirmedPortConflict: async () => false })
    await runner.start('d1')
    await tick()
    children[0].close(1)
    await tick()
    expect(children).toHaveLength(1)
    expect(events.unexpectedExit).toHaveBeenCalledTimes(1)
  })

  it('stderr 只保留有界尾巴', async () => {
    const { children } = makeRunner()
    expect(stderrTailText([Buffer.from('a'.repeat(5000))]).length).toBeLessThanOrEqual(4096)
    void children
  })
})

describe('EmulatorRunner 停止', () => {
  const startRunning = async (harness: Harness): Promise<string> => {
    const { runner } = harness
    const { runId } = await runner.start('d1')
    await tick()
    return runId
  }

  it('停止：beforeKill → SIGTERM → 退出确认 → 登记/端口释放', async () => {
    const harness = makeRunner({ bootProbe: async () => true })
    await startRunning(harness)
    const { runner, children, events } = harness
    const stopping = runner.stop('d1')
    await tick(1) // fake child 的 close 走异步 setTimeout(0)
    await expect(stopping).resolves.toBeUndefined()
    expect(events.beforeKill).toHaveBeenCalledTimes(1)
    expect(children[0].kills).toContain('SIGTERM')
    expect(children[0].kills).not.toContain('SIGKILL')
    expect(runner.phaseOf('d1')).toBeNull()
  })

  it('SIGTERM 不退 → 3s 后升级 SIGKILL', async () => {
    const harness = makeRunner({ bootProbe: async () => true })
    await startRunning(harness)
    const { runner, children } = harness
    children[0].dieOn = 'SIGKILL'
    const stopping = runner.stop('d1')
    await tick(0)
    expect(children[0].kills).toContain('SIGTERM')
    await tick(TERM_GRACE_MS)
    expect(children[0].kills).toContain('SIGKILL')
    await tick(1) // SIGKILL 触发的异步 close 再冲一拍
    await expect(stopping).resolves.toBeUndefined()
  })

  it('限期不退 → 停止失败抛错；entry 保留可重试', async () => {
    const harness = makeRunner({ bootProbe: async () => true })
    await startRunning(harness)
    const { runner, children } = harness
    children[0].dieOn = 'never'
    const stopping = runner.stop('d1')
    const assertion = expect(stopping).rejects.toThrow('停止超时')
    await tick(TERM_GRACE_MS + KILL_GRACE_MS + 1_000)
    await assertion
    expect(runner.phaseOf('d1')).toBe('stopping')
    // 重试：cleanup 已清空，重新走终止
    children[0].dieOn = 'SIGTERM'
    const retry = runner.stop('d1')
    await tick(1)
    await expect(retry).resolves.toBeUndefined()
    expect(runner.phaseOf('d1')).toBeNull()
  })

  it('停止中的重复请求合并同一份清理', async () => {
    const harness = makeRunner({ bootProbe: async () => true })
    await startRunning(harness)
    const { runner, children } = harness
    children[0].dieOn = 'SIGKILL'
    const first = runner.stop('d1')
    const second = runner.stop('d1')
    await tick(TERM_GRACE_MS + 1_000)
    await tick(1)
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(children[0].kills.filter((signal) => signal === 'SIGTERM')).toHaveLength(1)
  })

  it('running 期间崩溃 → 非预期退出（带 close 码），不弹停止流', async () => {
    const harness = makeRunner({ bootProbe: async () => true })
    await startRunning(harness)
    const { runner, children, events } = harness
    children[0].close(137)
    await tick()
    expect(events.unexpectedExit).toHaveBeenCalledWith('d1', expect.any(String), {
      code: 137,
      stderrTail: ''
    })
    expect(runner.phaseOf('d1')).toBeNull()
  })
})

describe('EmulatorRunner 退出清理', () => {
  it('disposeAll 停掉全部实例并拒绝新启动', async () => {
    const { runner, children } = makeRunner({ bootProbe: async () => true })
    await runner.start('d1')
    await runner.start('d2')
    await tick()
    const disposing = runner.disposeAll()
    await tick(1)
    const leftovers = await disposing
    expect(leftovers).toEqual([])
    expect(children).toHaveLength(2)
    for (const child of children) expect(child.kills).toContain('SIGTERM')
    await expect(runner.start('d3')).rejects.toThrow('暂停启动')
  })
})
