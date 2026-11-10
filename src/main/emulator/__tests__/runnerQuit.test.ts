// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { abortableSleep } from '../abort'
import { describe, expect, it, vi } from 'vitest'
import { EmulatorRunner, type RunnerDeps } from '../runner'
import { PortAllocator } from '../ports'

/** fake qemu 子进程：close 由用例显式触发（quit 走 console kill，不发信号） */
class FakeChild extends EventEmitter {
  pid = 4321
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stderr = new EventEmitter()
  readonly stdout = new EventEmitter()
  spawnargs: string[] = []
  constructor() {
    super()
  }
  kill = vi.fn((): boolean => true)
  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return
    if (code === null) this.signalCode = signal
    else this.exitCode = code
    this.emit('close', code, signal)
  }
}

const makeRunner = (
  consoleExec: RunnerDeps['consoleExec']
): {
  runner: EmulatorRunner
  children: FakeChild[]
  events: { running: ReturnType<typeof vi.fn>; unexpectedExit: ReturnType<typeof vi.fn> }
} => {
  const children: FakeChild[] = []
  const events = { running: vi.fn(), unexpectedExit: vi.fn() }
  const runner = new EmulatorRunner({
    sdkRoot: () => '/sdk',
    avdHome: () => '/avd',
    emulatorPath: () => '/emu',
    adbPath: () => '/adb',
    ports: new PortAllocator({ probeTcp: async () => false, adbSerials: async () => new Set() }),
    ensureAdbServer: async () => {},
    bootProbe: vi.fn(async () => true),
    adbSerials: async () => new Set(),
    spawnEmulator: ((_path: string, args: string[]) => {
      const child = new FakeChild()
      child.spawnargs = args
      children.push(child)
      return child as unknown as ChildProcess
    }) as RunnerDeps['spawnEmulator'],
    platform: 'darwin',
    sleep: abortableSleep,
    now: () => Date.now(),
    confirmedPortConflict: async () => false,
    onRunning: events.running,
    onUnexpectedExit: events.unexpectedExit,
    consoleExec
  })
  return { runner, children, events }
}

/** 就绪一个 running 实例（真实 boot 路径），返回其 console 端口 */
const bootRunning = async (runner: EmulatorRunner): Promise<number> => {
  const { runId, serial } = await runner.start('dev-1')
  // boot 探测立即通过（bootProbe=true）→ onRunning 已触发 running
  await vi.waitFor(() => expect(runner.phaseOf('dev-1')).toBe('running'))
  void runId
  void serial
  const port = runner.portOf('dev-1')
  expect(port).toBeDefined()
  return port!
}

describe('runner 休眠退出（quit；plan 2026-11-06 设计 D5）', () => {
  it('portOf：无实例 undefined；运行中有值', async () => {
    const { runner } = makeRunner(async () => 'OK')
    expect(runner.portOf('dev-1')).toBeUndefined()
    await bootRunning(runner)
    expect(typeof runner.portOf('dev-1')).toBe('number')
  })

  it('quit：console kill → 进程关闭 → 登记与端口释放', async () => {
    const consoleExec = vi.fn(async (port: number, command: string) => {
      expect(command).toBe('kill')
      void port
      return 'OK: killing emulator, bye bye'
    })
    const { runner, children, events } = makeRunner(consoleExec)
    await bootRunning(runner)
    const quitDone = runner.quit('dev-1')
    // console kill 返回后进程关闭（异步模拟真实时序）
    setTimeout(() => children[0]!.close(0), 10)
    await quitDone
    expect(runner.phaseOf('dev-1')).toBeNull()
    expect(runner.portOf('dev-1')).toBeUndefined()
    // 优雅退出不是崩溃：不得触发 onUnexpectedExit
    expect(events.unexpectedExit).not.toHaveBeenCalled()
  })

  it('quit 失败（进程不退）：抛错且保留 entry——调用侧保持真实占用状态', async () => {
    vi.useFakeTimers()
    try {
      const { runner } = makeRunner(async () => 'OK')
      await bootRunning(runner)
      const promise = runner.quit('dev-1')
      promise.catch(() => undefined)
      await vi.advanceTimersByTimeAsync(35_000)
      await expect(promise).rejects.toThrow(/未能退出|优雅退出|timeout/i)
      // entry 保留、phase 回 running：资源占用真实可见，可重试
      expect(runner.phaseOf('dev-1')).toBe('running')
      expect(runner.portOf('dev-1')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('quit 被拒（KO）：抛错且 phase 回 running', async () => {
    const { runner } = makeRunner(async () => 'KO: not now')
    await bootRunning(runner)
    await expect(runner.quit('dev-1')).rejects.toThrow(/拒绝/)
    expect(runner.phaseOf('dev-1')).toBe('running')
  })

  it('quit 对 starting/stopping 实例拒绝', async () => {
    const { runner } = makeRunner(async () => 'OK')
    await expect(runner.quit('dev-1')).rejects.toThrow(/没有运行中的实例/)
  })
})
