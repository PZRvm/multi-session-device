import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { serialForPort, tcpProbe, type PortAllocator } from './ports'
import { listAdbSerials, runAdb, scrubAdbEnv } from './adb'
import { abortableSleep, awaitWithAbort } from './abort'
import { emuConsoleExec } from './emuConsole'
import { msg } from '../locale'

// 容错上限（非冷启动验收耗时）：PoC 实测无头冷启动 ~24s，超时裕量留给慢机器
export const BOOT_TIMEOUT_MS = 240_000
export const BOOT_INTERVAL_MS = 1_500
export const TERM_GRACE_MS = 3_000
export const KILL_GRACE_MS = 5_000
/** console kill 命令本身的往返期限（PoC 实测退出 ~1.5-2s，裕量放大） */
export const CONSOLE_KILL_TIMEOUT_MS = 15_000
/** console kill 后等待进程关闭的期限（保存后退出通常数秒内） */
export const QUIT_GRACE_MS = 30_000
const STDERR_TAIL_BYTES = 4096

export type RunnerPhase = 'starting' | 'running' | 'stopping'

type StartResult = { runId: string; serial: string }

interface StartPreparation {
  phase: 'starting' | 'stopping'
  abort: AbortController
  result: Promise<StartResult>
}

/** 主动取消是正常生命周期结果，devices 层无需弹启动失败。 */
export class StartCancelledError extends Error {
  constructor() {
    super(msg('runnerStartCancelled'))
  }
}

export interface UnexpectedExitInfo {
  code: number
  stderrTail: string
  /** 进程 stdout 尾部（参数解析等致命错误只打在 stdout——37.2.12 实测） */
  stdoutTail: string
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
  stdoutChunks: Buffer[]
  /** stop/cancel 共享同一份清理 Promise；失败后置空允许重试 */
  cleanup: Promise<void> | null
  closed: Promise<number | null>
}

export interface RunnerDeps {
  sdkRoot: () => string
  avdHome: () => string
  /** ANDROID_USER_HOME/EMULATOR_HOME（恒定应用数据目录）；缺省用 SDK 根内旧布局 */
  userHome?: () => string
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
  /** 平台接缝（默认 process.platform）：win32 决定 detached 与停止路径（树杀 vs 进程组信号） */
  platform?: NodeJS.Platform
  /** win32 树杀（taskkill /PID /T /F）；缺省 defaultKillTree，接缝供单测注入 */
  killTree?: (pid: number) => Promise<void>
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  now: () => number
  /** 启动失败后的外部占用复核：进程已退但端口仍可连 = 确认端口冲突（可换端口重试一次） */
  confirmedPortConflict: (port: number) => Promise<boolean>
  /**
   * 设备运行字段（settingsToRunnerArgs 的产物；devices 域按元数据构造）。
   * 缺省 = legacy 固定 Cold/host——旧设备（advancedSettings 为 null）行为不变。
   */
  extraArgsFor?: (id: string) => string[]
  /**
   * 启动准备前置（plan 2026-10-05-avd-reconciliation 设计 4）：共享 ADB/端口步骤
   * 之前执行的单目标文件核验与摄像头检查；取消/退出经 signal 中止等待，迟到
   * 结果不 spawn。失败按启动失败收口（onUnexpectedExit 由调用侧合并 lastError）。
   */
  beforeStart?: (id: string, runId: string, signal: AbortSignal) => Promise<void>
  /** boot 后的受控恢复，完成前不发布 running；取消与进程退出仍可打断。 */
  afterBoot?: (id: string, runId: string, serial: string, signal: AbortSignal) => Promise<void>
  /** boot 完成（serial 已随事件发布，可能因端口冲突重试与本对不同） */
  onRunning: (id: string, runId: string, serial: string) => void
  /** 非预期退出：崩溃/启动失败——写回 lastError 与后台错误通知 */
  onUnexpectedExit: (id: string, runId: string, info: UnexpectedExitInfo) => void
  /** 终止前钩子（投屏会话释放；stream 步骤接入）——失败不阻塞进程终止 */
  beforeKill?: (id: string, runId: string) => Promise<void>
  /**
   * console 命令执行（休眠域）：按 console 端口认证并执行单条命令。
   * 缺省用 emuConsole 实现；接缝供单测注入。
   */
  consoleExec?: (port: number, command: string, timeoutMs: number) => Promise<string>
}

export const stderrTailText = (chunks: Buffer[]): string => {
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text.length > STDERR_TAIL_BYTES ? text.slice(-STDERR_TAIL_BYTES) : text
}

/** 追加并保留尾部（约 4×截断上限）：长会话的 emulator 输出不无限吃内存 */
const pushTailChunk = (chunks: Buffer[], chunk: Buffer): void => {
  chunks.push(chunk)
  let total = chunk.length
  for (let index = 0; index < chunks.length - 1; index += 1) total += chunks[index]!.length
  while (total > STDERR_TAIL_BYTES * 4 && chunks.length > 1) total -= chunks.shift()!.length
}

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

/** win32 树杀默认实现：taskkill /T 连启动器带 qemu 整树终止。恒 /F 硬杀——
 *  -no-window 模拟器无消息循环，taskkill 不带 /F 发不出 WM_CLOSE；优雅退出
 *  归 emulator console kill（backlog，见 plan 2026-10-22-windows-process-mgmt）。
 *  spawnFn 接缝仅供单测注入。 */
export const defaultKillTree = (
  pid: number,
  spawnFn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess = spawn
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawnFn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    child.stderr?.on('data', () => undefined) // drain：防管道写满把 taskkill 阻塞在写 stderr
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`taskkill: ${code}`))))
  })

/** boot 期间进程提前退出（崩溃/端口被抢静默 exit 1）——带真实退出码走失败收口 */
class EarlyExitError extends Error {
  constructor(readonly exitCode: number) {
    super(msg('runnerEarlyExit', { code: exitCode }))
  }
}

/** emulator 进程池：一次启动一个代次（runId），取消/迟到回调用它防串台 */
export class EmulatorRunner {
  readonly #entries = new Map<string, RunnerEntry>()
  readonly #preparing = new Map<string, StartPreparation>()
  #accepting = true

  constructor(private readonly deps: RunnerDeps) {}

  /**
   * 接纳一次启动：登记代次并异步 boot，返回不等待 boot 完成。
   * 已在 starting/running 时幂等返回现态；stopping 拒绝（等停止收口）。
   */
  async start(id: string, runId = randomUUID()): Promise<StartResult> {
    if (!this.#accepting) throw new Error(msg('appClosingNoStart'))
    const preparing = this.#preparing.get(id)
    if (preparing?.phase === 'starting') return preparing.result
    if (preparing) throw new Error(msg('startPrevStopPending'))
    const existing = this.#entries.get(id)
    if (existing && existing.phase !== 'stopping') {
      return { runId: existing.runId, serial: existing.serial }
    }
    if (existing) throw new Error(msg('startPrevStopPending'))

    const preparation: StartPreparation = {
      phase: 'starting',
      abort: new AbortController(),
      result: Promise.resolve().then(() => this.#prepare(id, runId, preparation))
    }
    this.#preparing.set(id, preparation)
    return preparation.result
  }

  async #prepare(id: string, runId: string, preparation: StartPreparation): Promise<StartResult> {
    const signal = preparation.abort.signal
    try {
      if (this.deps.beforeStart !== undefined) {
        await awaitWithAbort(() => this.deps.beforeStart!(id, runId, signal), signal)
      }
      await awaitWithAbort(() => this.deps.ensureAdbServer(), signal)
      const port = await this.deps.ports.acquire(id, signal)
      const serial = serialForPort(port)
      // 残留实例显式拦截：占 AVD 锁的旧实例会让新实例静默 exit 1，事后无法排查
      const serials = await awaitWithAbort(() => this.deps.adbSerials(), signal)
      signal.throwIfAborted()
      if (serials.has(serial)) {
        throw new Error(msg('runnerSerialOccupied', { serial }))
      }
      const entry: RunnerEntry = {
        id,
        runId,
        port,
        serial,
        child: null as unknown as ChildProcess,
        phase: 'starting',
        abort: preparation.abort,
        stderrChunks: [],
        stdoutChunks: [],
        cleanup: null,
        closed: Promise.resolve(null)
      }
      this.#entries.set(id, entry)
      this.#preparing.delete(id)
      void this.#runBoot(entry)
      return { runId, serial }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw error
    } finally {
      if (this.#preparing.get(id) === preparation) {
        this.#preparing.delete(id)
        this.deps.ports.release(id)
      }
    }
  }

  /** 取消启动：仅 starting 可取消；running 返回状态冲突（不能把迟到取消当停止） */
  async cancelStart(id: string): Promise<void> {
    const preparing = this.#preparing.get(id)
    if (preparing) {
      preparing.phase = 'stopping'
      preparing.abort.abort(new StartCancelledError())
      await preparing.result.catch(() => undefined)
      return
    }
    const entry = this.#requireEntry(id)
    if (entry.phase === 'running') {
      throw new Error(msg('cancelWhileRunning'))
    }
    if (entry.phase === 'starting') {
      entry.phase = 'stopping'
      entry.abort.abort()
    }
    await this.#terminateEntry(entry)
  }

  /** 停止运行实例；stopping 的重复/重试请求合并到同一份清理 */
  async stop(id: string): Promise<void> {
    if (this.#preparing.has(id)) throw new Error(msg('stopWhileStarting'))
    const entry = this.#requireEntry(id)
    if (entry.phase === 'starting') throw new Error(msg('stopWhileStarting'))
    if (entry.phase === 'stopping' && entry.cleanup) return entry.cleanup
    entry.phase = 'stopping'
    entry.abort.abort()
    await this.#terminateEntry(entry)
  }

  phaseOf(id: string): RunnerPhase | null {
    return this.#entries.get(id)?.phase ?? this.#preparing.get(id)?.phase ?? null
  }

  serialOf(id: string): string | undefined {
    return this.#entries.get(id)?.serial
  }

  /** console 端口（休眠保存/优雅退出的目标）；无活动实例时 undefined */
  portOf(id: string): number | undefined {
    return this.#entries.get(id)?.port
  }

  /**
   * 休眠退出（plan 2026-11-06 设计 D5）：经 console kill 优雅退出本实例，进程关闭
   * 后释放端口登记。不调用 beforeKill（休眠流程在保存前已自行拆除媒体会话）。
   * 失败（console 不通/超时不退）抛错并保留 entry——状态由调用侧解释为
   * hibernating 退出失败（可重试），不得显示已释放。
   */
  async quit(id: string): Promise<void> {
    if (this.#preparing.has(id)) throw new Error(msg('stopWhileStarting'))
    const entry = this.#requireEntry(id)
    if (entry.phase === 'stopping') throw new Error(msg('runnerNoInstance'))
    if (entry.phase !== 'running') throw new Error(msg('stopWhileStarting'))
    entry.phase = 'stopping'
    const exec =
      this.deps.consoleExec ??
      ((port: number, command: string, timeoutMs: number) =>
        emuConsoleExec(port, command, timeoutMs))
    const response = await exec(entry.port, 'kill', CONSOLE_KILL_TIMEOUT_MS)
    if (/KO/i.test(response)) {
      entry.phase = 'running'
      throw new Error(msg('hibernateKillRejected', { response }))
    }
    if (!(await this.#closedWithin(entry, QUIT_GRACE_MS))) {
      // 进程未退：保留 entry（phase 回 running，实例仍在跑）——调用侧保持资源占用状态
      entry.phase = 'running'
      throw new Error(msg('hibernateQuitTimeout'))
    }
    this.#entries.delete(id)
    this.deps.ports.release(id)
  }

  activeIds(): string[] {
    return [...this.#preparing.keys(), ...this.#entries.keys()]
  }

  /** 退出清理：拒绝新启动，停掉全部实例；返回仍占用的设备 id（有界，不悬挂） */
  async disposeAll(): Promise<string[]> {
    this.#accepting = false
    const entries = [...this.#entries.values()]
    await Promise.allSettled([
      ...[...this.#preparing.keys()].map((id) => this.cancelStart(id)),
      ...entries.map(async (entry) => {
        entry.phase = 'stopping'
        entry.abort.abort()
        await this.#terminateEntry(entry)
      })
    ])
    return this.activeIds()
  }

  /** 用户选择留在应用后恢复启动接纳（disposeAll 之后唯一入口） */
  resumeAccepting(): void {
    this.#accepting = true
  }

  #requireEntry(id: string): RunnerEntry {
    const entry = this.#entries.get(id)
    if (!entry) throw new Error(msg('runnerNoInstance'))
    return entry
  }

  #isWin32(): boolean {
    return (this.deps.platform ?? process.platform) === 'win32'
  }

  #spawnFor(entry: RunnerEntry): void {
    // 运行字段优先级：设备已验证设置 → legacy 固定 Cold/host（不改已有设备行为）
    const extra = this.deps.extraArgsFor?.(entry.id) ?? ['-no-snapshot', '-gpu', 'host']
    const child = this.deps.spawnEmulator(
      this.deps.emulatorPath(),
      ['-avd', entry.id, '-no-window', ...extra, '-port', String(entry.port)],
      {
        // detached 建独立进程组：真身 qemu 与启动器同组，停止按组整组终止（win32
        // 无进程组语义，且 detached 会开新控制台、与 windowsHide 冲突——nodejs/node#21825）；
        // stdout 也要：emulator 的致命参数错误只打在 stdout（2026-10-09 实测）
        detached: !this.#isWin32(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: scrubAdbEnv({
          ...process.env,
          ANDROID_SDK_ROOT: this.deps.sdkRoot(),
          ANDROID_HOME: this.deps.sdkRoot(),
          ANDROID_AVD_HOME: this.deps.avdHome(),
          ANDROID_USER_HOME: this.deps.userHome?.() ?? join(this.deps.sdkRoot(), 'android-user'),
          ANDROID_EMULATOR_HOME: this.deps.userHome?.() ?? join(this.deps.sdkRoot(), 'android-user')
        })
      }
    )
    entry.child = child
    entry.stderrChunks = []
    entry.stdoutChunks = []
    entry.closed = new Promise<number | null>((resolve) => {
      child.once('close', (code) => resolve(code ?? null))
    })
    child.once('close', (code) => this.#onClosed(entry, code ?? -1))
    // spawn 失败（ENOENT 等）只发 'error' 事件：无监听会以未捕获异常击穿主进程，
    // 且 boot 等待侧毫无痕迹——记日志并按早期退出收口
    child.once('error', (error) => console.error(`[runner] spawn 失败：${String(error)}`))
    child.stderr?.on('data', (chunk: Buffer) => pushTailChunk(entry.stderrChunks, chunk))
    child.stdout?.on('data', (chunk: Buffer) => pushTailChunk(entry.stdoutChunks, chunk))
  }

  /** running 期间的进程退出 = 非预期崩溃；starting 期间由 #runBoot 收口（含端口冲突重试） */
  #onClosed(entry: RunnerEntry, code: number): void {
    if (this.#entries.get(entry.id) !== entry) return
    if (entry.phase !== 'running' || entry.abort.signal.aborted) return
    this.#entries.delete(entry.id)
    this.deps.ports.release(entry.id)
    this.deps.onUnexpectedExit(entry.id, entry.runId, {
      code,
      stderrTail: stderrTailText(entry.stderrChunks),
      stdoutTail: stderrTailText(entry.stdoutChunks)
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
        // 接纳结果先交回 devices 登记，再探测 boot；准备 Promise 的层数不影响此顺序。
        await Promise.race([
          this.deps.sleep(0, entry.abort.signal).then(() => this.#bootWait(entry)),
          earlyExit
        ])
        if (this.deps.afterBoot) {
          await Promise.race([
            awaitWithAbort(
              () => this.deps.afterBoot!(entry.id, entry.runId, entry.serial, entry.abort.signal),
              entry.abort.signal
            ),
            earlyExit
          ])
        }
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
        const stdoutTail = stderrTailText(entry.stdoutChunks)
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
            stderrTail: tail.length > 0 ? tail : message,
            stdoutTail
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
            stderrTail: allocError instanceof Error ? allocError.message : String(allocError),
            stdoutTail: ''
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
    throw new Error(msg('runnerBootTimeout', { seconds: BOOT_TIMEOUT_MS / 1000 }))
  }

  /** stop/cancel 共用：posix SIGTERM → 3s → SIGKILL；win32 taskkill 树杀×2；失败保留 entry 供重试 */
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
    if (this.#isWin32()) {
      // win32 无进程组/信号语义：taskkill 整树硬杀。非零退出多为竞态（子进程刚
      // 自行退出）——宽限内收口即成功；真失败有界间隔重试一次，仍失败保留 entry
      // 供重试（口径同 posix 限期不退）。
      if (alive && entry.child.pid !== undefined) {
        const killTree = this.deps.killTree ?? defaultKillTree
        try {
          await killTree(entry.child.pid)
        } catch {
          if (!(await this.#closedWithin(entry, TERM_GRACE_MS))) {
            await this.deps.sleep(TERM_GRACE_MS)
            try {
              await killTree(entry.child.pid)
            } catch {
              if (!(await this.#closedWithin(entry, TERM_GRACE_MS))) {
                throw new Error(msg('runnerStopTimeout'))
              }
            }
          }
        }
      }
      if (!(await this.#closedWithin(entry, KILL_GRACE_MS))) {
        throw new Error(msg('runnerStopTimeout'))
      }
    } else {
      if (alive) killGroup('SIGTERM')
      if (!(await this.#closedWithin(entry, TERM_GRACE_MS))) {
        if (alive) killGroup('SIGKILL')
        if (!(await this.#closedWithin(entry, KILL_GRACE_MS))) {
          throw new Error(msg('runnerStopTimeout'))
        }
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
