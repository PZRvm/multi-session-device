import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { serialForPort, tcpProbe, type PortAllocator } from './ports'
import { listAdbSerials, runAdb, scrubAdbEnv } from './adb'

// 容错上限（非冷启动验收耗时）：PoC 实测无头冷启动 ~24s，超时裕量留给慢机器
export const BOOT_TIMEOUT_MS = 240_000
export const BOOT_INTERVAL_MS = 1_500
export const TERM_GRACE_MS = 3_000
export const KILL_GRACE_MS = 5_000
const STDERR_TAIL_BYTES = 4096

export type RunnerPhase = 'starting' | 'running' | 'stopping'

export interface UnexpectedExitInfo {
  code: number
  stderrTail: string
}

export interface RunnerEntry {
  id: string
  runId: string
  port: number
  serial: string
  child: ChildProcess
  phase: RunnerPhase
  abort: AbortController
  stderrChunks: Buffer[]
  /** stop/cancel 共享同一份清理 Promise；失败后置空允许重试 */
  cleanup: Promise<void> | null
  closed: Promise<number | null>
}

export interface RunnerDeps {
  sdkRoot: () => string
  avdHome: () => string
  emulatorPath: () => string
  adbPath: () => string
  ports: PortAllocator
  /** 共享 server 存续策略（adb.ts ensureSharedServer）——失败即拒绝启动 */
  ensureAdbServer: () => Promise<void>
  /** boot 探测：目标 serial 的 sys.boot_completed 是否为 1（单次命令自带超时） */
  bootProbe: (serial: string) => Promise<boolean>
  /** 共享 server 已登记 serial 集 */
  adbSerials: () => Promise<Set<string>>
  spawnEmulator: (path: string, args: string[], options: SpawnOptions) => ChildProcess
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  now: () => number
  /** 启动失败后的外部占用复核：进程已退但端口仍可连 = 确认端口冲突（可换端口重试一次） */
  confirmedPortConflict: (port: number) => Promise<boolean>
  /**
   * 设备运行字段（settingsToRunnerArgs 的产物；devices 域按元数据构造）。
   * 缺省 = legacy 固定 Cold/host——旧设备（advancedSettings 为 null）行为不变。
   */
  extraArgsFor?: (id: string) => string[]
  /** boot 完成（serial 已随事件发布，可能因端口冲突重试与本对不同） */
  onRunning: (id: string, runId: string, serial: string) => void
  /** 非预期退出：崩溃/启动失败——写回 lastError 与后台错误通知 */
  onUnexpectedExit: (id: string, runId: string, info: UnexpectedExitInfo) => void
  /** 终止前钩子（投屏会话释放；stream 步骤接入）——失败不阻塞进程终止 */
  beforeKill?: (id: string, runId: string) => Promise<void>
}

export const stderrTailText = (chunks: Buffer[]): string => {
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text.length > STDERR_TAIL_BYTES ? text.slice(-STDERR_TAIL_BYTES) : text
}

const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true }
    )
  })

/** boot 探测默认实现：getprop 单次命令 5s 超时，adbd 未就绪时按未启动继续等 */
export const defaultBootProbe =
  (adbPath: () => string) =>
  async (serial: string): Promise<boolean> => {
    const result = await runAdb(
      adbPath(),
      ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
      {
        timeoutMs: 5_000
      }
    )
    return result.stdout.trim() === '1'
  }

const defaultNow = (): number => Date.now()

/** boot 期间进程提前退出（崩溃/端口被抢静默 exit 1）——带真实退出码走失败收口 */
class EarlyExitError extends Error {
  constructor(readonly exitCode: number) {
    super(`模拟器进程提前退出（exit ${exitCode}）`)
  }
}

/** emulator 进程池：一次启动一个代次（runId），取消/迟到回调用它防串台 */
export class EmulatorRunner {
  readonly #entries = new Map<string, RunnerEntry>()
  #accepting = true

  constructor(private readonly deps: RunnerDeps) {}

  /**
   * 接纳一次启动：登记代次并异步 boot，返回不等待 boot 完成。
   * 已在 starting/running 时幂等返回现态；stopping 拒绝（等停止收口）。
   */
  async start(id: string): Promise<{ runId: string; serial: string }> {
    if (!this.#accepting) throw new Error('应用退出清理中，暂停启动')
    const existing = this.#entries.get(id)
    if (existing && existing.phase !== 'stopping') {
      return { runId: existing.runId, serial: existing.serial }
    }
    if (existing) throw new Error('上一次停止尚未完成，稍后再启动')

    await this.deps.ensureAdbServer()
    const port = await this.deps.ports.acquire(id)
    const serial = serialForPort(port)
    // 残留实例显式拦截：占 AVD 锁的旧实例会让新实例静默 exit 1，事后无法排查
    const serials = await this.deps.adbSerials()
    if (serials.has(serial)) {
      this.deps.ports.release(id)
      throw new Error(`${serial} 已被占用（可能是残留的模拟器进程），请先停止该实例再启动`)
    }
    const runId = randomUUID()
    const entry: RunnerEntry = {
      id,
      runId,
      port,
      serial,
      child: null as unknown as ChildProcess,
      phase: 'starting',
      abort: new AbortController(),
      stderrChunks: [],
      cleanup: null,
      closed: Promise.resolve(null)
    }
    this.#entries.set(id, entry)
    void this.#runBoot(entry)
    return { runId, serial }
  }

  /** 取消启动：仅 starting 可取消；running 返回状态冲突（不能把迟到取消当停止） */
  async cancelStart(id: string): Promise<void> {
    const entry = this.#requireEntry(id)
    if (entry.phase === 'running') {
      throw new Error('设备已在运行，取消不再适用（可改为停止）')
    }
    if (entry.phase === 'starting') {
      entry.phase = 'stopping'
      entry.abort.abort()
    }
    await this.#terminateEntry(entry)
  }

  /** 停止运行实例；stopping 的重复/重试请求合并到同一份清理 */
  async stop(id: string): Promise<void> {
    const entry = this.#requireEntry(id)
    if (entry.phase === 'starting') throw new Error('设备启动中：请取消启动而非停止')
    if (entry.phase === 'stopping' && entry.cleanup) return entry.cleanup
    entry.phase = 'stopping'
    entry.abort.abort()
    await this.#terminateEntry(entry)
  }

  phaseOf(id: string): RunnerPhase | null {
    return this.#entries.get(id)?.phase ?? null
  }

  serialOf(id: string): string | undefined {
    return this.#entries.get(id)?.serial
  }

  activeIds(): string[] {
    return [...this.#entries.keys()]
  }

  /** 退出清理：拒绝新启动，停掉全部实例；返回仍占用的设备 id（有界，不悬挂） */
  async disposeAll(): Promise<string[]> {
    this.#accepting = false
    const entries = [...this.#entries.values()]
    await Promise.allSettled(
      entries.map(async (entry) => {
        entry.phase = 'stopping'
        entry.abort.abort()
        await this.#terminateEntry(entry)
      })
    )
    return this.activeIds()
  }

  /** 用户选择留在应用后恢复启动接纳（disposeAll 之后唯一入口） */
  resumeAccepting(): void {
    this.#accepting = true
  }

  #requireEntry(id: string): RunnerEntry {
    const entry = this.#entries.get(id)
    if (!entry) throw new Error('设备没有运行中的实例')
    return entry
  }

  #spawnFor(entry: RunnerEntry): void {
    // 运行字段优先级：设备已验证设置 → legacy 固定 Cold/host（不改已有设备行为）
    const extra = this.deps.extraArgsFor?.(entry.id) ?? ['-no-snapshot', '-gpu', 'host']
    const child = this.deps.spawnEmulator(
      this.deps.emulatorPath(),
      ['-avd', entry.id, '-no-window', ...extra, '-port', String(entry.port)],
      {
        // detached 建独立进程组：真身 qemu 与启动器同组，停止按组整组终止
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: scrubAdbEnv({
          ...process.env,
          ANDROID_SDK_ROOT: this.deps.sdkRoot(),
          ANDROID_HOME: this.deps.sdkRoot(),
          ANDROID_AVD_HOME: this.deps.avdHome(),
          ANDROID_USER_HOME: join(this.deps.sdkRoot(), 'android-user'),
          ANDROID_EMULATOR_HOME: join(this.deps.sdkRoot(), 'android-user')
        })
      }
    )
    entry.child = child
    entry.stderrChunks = []
    entry.closed = new Promise<number | null>((resolve) => {
      child.once('close', (code) => resolve(code ?? null))
    })
    child.once('close', (code) => this.#onClosed(entry, code ?? -1))
    child.stderr?.on('data', (chunk: Buffer) => entry.stderrChunks.push(chunk))
  }

  /** running 期间的进程退出 = 非预期崩溃；starting 期间由 #runBoot 收口（含端口冲突重试） */
  #onClosed(entry: RunnerEntry, code: number): void {
    if (this.#entries.get(entry.id) !== entry) return
    if (entry.phase !== 'running' || entry.abort.signal.aborted) return
    this.#entries.delete(entry.id)
    this.deps.ports.release(entry.id)
    this.deps.onUnexpectedExit(entry.id, entry.runId, {
      code,
      stderrTail: stderrTailText(entry.stderrChunks)
    })
  }

  async #runBoot(entry: RunnerEntry): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      this.#spawnFor(entry)
      // boot 等待与进程提前退出竞争：崩溃不能傻等超时
      const earlyExit: Promise<never> = entry.closed.then((code): never => {
        throw new EarlyExitError(code ?? -1)
      })
      earlyExit.catch(() => undefined) // 竞败分支不产生 unhandled rejection
      try {
        await Promise.race([this.#bootWait(entry), earlyExit])
        if (this.#entries.get(entry.id) !== entry || entry.abort.signal.aborted) return
        entry.phase = 'running'
        this.deps.onRunning(entry.id, entry.runId, entry.serial)
        return
      } catch (error) {
        if (this.#entries.get(entry.id) !== entry) return
        // 取消/停止/退出清理已 abort：收口归它们，这里不得再报非预期退出
        if (entry.abort.signal.aborted) return
        // 失败收口先 abort：封住迟到的 close 与 boot 回调
        entry.abort.abort()
        const tail = stderrTailText(entry.stderrChunks)
        // 只对确认的端口冲突换下一对端口：进程已退但端口仍被外部占着
        const portConflict = attempt === 0 && (await this.deps.confirmedPortConflict(entry.port))
        await this.#terminateEntry(entry).catch(() => undefined)
        this.deps.ports.release(entry.id)
        if (!portConflict) {
          this.#entries.delete(entry.id)
          const code = error instanceof EarlyExitError ? error.exitCode : -1
          const message = error instanceof Error ? error.message : String(error)
          this.deps.onUnexpectedExit(entry.id, entry.runId, {
            code,
            stderrTail: tail.length > 0 ? tail : message
          })
          return
        }
        this.deps.ports.releasePort(entry.port)
        try {
          entry.port = await this.deps.ports.acquire(entry.id)
          // 上轮失败清理已把 entry 摘出登记表、并 abort 了代次信号——重试要重新入册 + 新信号
          this.#entries.set(entry.id, entry)
          entry.abort = new AbortController()
        } catch (allocError) {
          this.#entries.delete(entry.id)
          this.deps.onUnexpectedExit(entry.id, entry.runId, {
            code: -1,
            stderrTail: allocError instanceof Error ? allocError.message : String(allocError)
          })
          return
        }
        entry.serial = serialForPort(entry.port)
      }
    }
  }

  async #bootWait(entry: RunnerEntry): Promise<void> {
    const deadline = this.deps.now() + BOOT_TIMEOUT_MS
    while (this.deps.now() < deadline) {
      if (entry.abort.signal.aborted) throw new Error('aborted')
      let booted = false
      try {
        booted = await this.deps.bootProbe(entry.serial)
      } catch {
        booted = false // adbd 未就绪时 getprop 失败，按未启动继续等
      }
      if (booted) return
      await this.deps.sleep(BOOT_INTERVAL_MS, entry.abort.signal)
    }
    throw new Error(`模拟器启动超时（${BOOT_TIMEOUT_MS / 1000}s 内 sys.boot_completed 未置 1）`)
  }

  /** stop/cancel 共用：SIGTERM → 3s → SIGKILL → 限期收口；失败保留 entry 供重试 */
  #terminateEntry(entry: RunnerEntry): Promise<void> {
    if (entry.cleanup) return entry.cleanup
    const cleanup = this.#terminate(entry).catch((error) => {
      if (entry.cleanup === cleanup) entry.cleanup = null
      throw error
    })
    entry.cleanup = cleanup
    return cleanup
  }

  async #terminate(entry: RunnerEntry): Promise<void> {
    try {
      await this.deps.beforeKill?.(entry.id, entry.runId)
    } catch {
      // 释放失败不阻塞进程终止
    }
    const alive = entry.child.exitCode === null && entry.child.signalCode === null
    const killGroup = (signal: NodeJS.Signals): void => {
      try {
        if (entry.child.pid) process.kill(-entry.child.pid, signal)
      } catch {
        try {
          entry.child.kill(signal)
        } catch {
          // 进程已消失
        }
      }
    }
    if (alive) killGroup('SIGTERM')
    if (!(await this.#closedWithin(entry, TERM_GRACE_MS))) {
      if (alive) killGroup('SIGKILL')
      if (!(await this.#closedWithin(entry, KILL_GRACE_MS))) {
        throw new Error('停止超时：模拟器进程组未在限期内退出')
      }
    }
    this.#entries.delete(entry.id)
    this.deps.ports.release(entry.id)
  }

  #closedWithin(entry: RunnerEntry, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      entry.closed.then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }
}

/** 工厂：注入默认实现（真实 spawn/真实 adb 探测）；测试可整体替换 */
export function createRunner(
  overrides: Partial<RunnerDeps> &
    Pick<
      RunnerDeps,
      | 'ports'
      | 'sdkRoot'
      | 'avdHome'
      | 'emulatorPath'
      | 'adbPath'
      | 'ensureAdbServer'
      | 'onRunning'
      | 'onUnexpectedExit'
    >
): EmulatorRunner {
  return new EmulatorRunner({
    bootProbe: defaultBootProbe(overrides.adbPath),
    adbSerials: () => listAdbSerials(overrides.adbPath()),
    spawnEmulator: spawn,
    sleep: abortableSleep,
    now: defaultNow,
    confirmedPortConflict: async (port: number): Promise<boolean> =>
      (await tcpProbe(port)) || (await tcpProbe(port + 1)),
    ...overrides
  })
}
