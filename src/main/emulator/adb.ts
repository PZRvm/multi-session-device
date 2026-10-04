import { connect as tcpConnect, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 共享 adb server 锁定本机默认 endpoint——不读宿主传入的远端配置 */
export const ADB_HOST = '127.0.0.1'
export const ADB_SERVER_PORT = 5037

/** 会改写 adb server 端点/端口的环境变量——spawn adb 前一律筛除 */
const ADB_ENDPOINT_ENV_KEYS = [
  'ADB_SERVER_SOCKET',
  'ANDROID_ADB_SERVER_PORT',
  'ANDROID_ADB_SERVER_ADDRESS'
] as const

export const scrubAdbEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const scrubbed = { ...env }
  for (const key of ADB_ENDPOINT_ENV_KEYS) delete scrubbed[key]
  return scrubbed
}

// ---- 帧编解码（smart-socket 协议：4 位十六进制长度 + 载荷）----

export const encodeAdbRequest = (payload: string): Buffer => {
  const length = Buffer.byteLength(payload, 'utf8').toString(16).padStart(4, '0')
  return Buffer.from(length + payload, 'utf8')
}

/** 解析 host:version 应答的载荷（hex 字符串 → 协议版本）；非 OKAY 返回 null */
export const parseAdbVersionPayload = (payload: string): number | null => {
  const version = Number.parseInt(payload, 16)
  return Number.isFinite(version) && payload.length > 0 ? version : null
}

export interface ServerProbe {
  running: boolean
  /** adb 协议版本（如 41）；server 未运行时缺省 */
  protocolVersion?: number
}

export interface ProbeDeps {
  connect?: typeof tcpConnect
}

/**
 * 只读探测共享 adb server（host:version 查询后立即断开）：
 * 不 start-server、不 kill-server——重启共享 server 的决定权永远不在这里。
 */
export async function probeServer(deps: ProbeDeps = {}): Promise<ServerProbe> {
  const connect = deps.connect ?? tcpConnect
  const socket = await new Promise<Socket>((resolve, reject) => {
    const conn = connect({ host: ADB_HOST, port: ADB_SERVER_PORT })
    conn.once('connect', () => resolve(conn))
    conn.once('error', reject)
  }).catch(() => null)
  if (!socket) return { running: false }

  return new Promise<ServerProbe>((resolve) => {
    const finish = (probe: ServerProbe): void => {
      socket.destroy()
      resolve(probe)
    }
    let buffer = Buffer.alloc(0)
    socket.setTimeout(3_000)
    socket.once('timeout', () => finish({ running: false }))
    socket.once('error', () => finish({ running: false }))
    socket.once('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      // 应答：OKAY/FAIL + 4 位长度 + 载荷
      if (buffer.length < 8) return
      const status = buffer.subarray(0, 4).toString('utf8')
      const length = Number.parseInt(buffer.subarray(4, 8).toString('utf8'), 16)
      if (!Number.isFinite(length) || buffer.length < 8 + length) return
      if (status !== 'OKAY') return finish({ running: false })
      const payload = buffer.subarray(8, 8 + length).toString('utf8')
      const protocolVersion = parseAdbVersionPayload(payload)
      finish(protocolVersion === null ? { running: false } : { running: true, protocolVersion })
    })
    socket.write(encodeAdbRequest('host:version'))
  })
}

// ---- 可执行文件解析与命令执行 ----

export interface AdbExecutable {
  path: string
  source: 'path' | 'standard-sdk' | 'app-sdk'
  /** `adb version` 首行的协议版本号（1.0.41 → 41） */
  protocolVersion: number
}

/** 用户已有 platform-tools 优先（PATH → 标准 SDK 候选），应用自有 adb 兜底 */
export function candidateAdbPaths(
  appSdkRoot: string
): Array<{ path: string; source: AdbExecutable['source'] }> {
  const candidates: Array<{ path: string; source: AdbExecutable['source'] }> = []
  for (const dir of (process.env['PATH'] ?? '').split(':')) {
    if (dir.length > 0) candidates.push({ path: join(dir, 'adb'), source: 'path' })
  }
  candidates.push({
    path: join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    source: 'standard-sdk'
  })
  candidates.push({ path: join(appSdkRoot, 'platform-tools', 'adb'), source: 'app-sdk' })
  return candidates
}

export interface AdbRunResult {
  code: number
  stdout: string
  /** 有界尾部（4KiB）——崩溃原因看尾部足够，不攒全量 */
  stderr: string
}

const STDERR_TAIL_BYTES = 4096

export async function runAdb(
  adbPath: string,
  args: string[],
  { timeoutMs = 10_000 } = {}
): Promise<AdbRunResult> {
  return new Promise<AdbRunResult>((resolve, reject) => {
    const child = spawn(adbPath, args, { env: scrubAdbEnv(process.env) })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            settled = true
            child.kill('SIGKILL')
            resolve({
              code: -1,
              stdout: Buffer.concat(out).toString('utf8'),
              stderr: `adb ${args.join(' ')} 超时（${timeoutMs}ms，已终止）`
            })
          }, timeoutMs)
        : undefined
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!settled) out.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!settled) err.push(chunk)
    })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (settled) return
      const stderr = Buffer.concat(err).toString('utf8')
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: stderr.length > STDERR_TAIL_BYTES ? stderr.slice(-STDERR_TAIL_BYTES) : stderr
      })
    })
  })
}

const resolveCandidate = async (candidate: {
  path: string
  source: AdbExecutable['source']
}): Promise<AdbExecutable | null> => {
  try {
    await access(candidate.path, constants.X_OK)
  } catch {
    return null
  }
  try {
    const result = await runAdb(candidate.path, ['version'], { timeoutMs: 5_000 })
    if (result.code !== 0) return null
    // 首行形如 "Android Debug Bridge version 1.0.41"
    const match = /version 1\.0\.(\d+)/.exec(result.stdout)
    if (!match) return null
    return { ...candidate, protocolVersion: Number.parseInt(match[1], 10) }
  } catch {
    return null
  }
}

/** 按候选顺序验证（可执行 + `adb version` 可跑），全部失败抛可操作错误 */
export async function resolveAdbExecutable(
  candidates: Array<{ path: string; source: AdbExecutable['source'] }>
): Promise<AdbExecutable> {
  for (const candidate of candidates) {
    const resolved = await resolveCandidate(candidate)
    if (resolved) return resolved
  }
  throw new Error(
    '找不到可用的 adb（PATH、标准 SDK 与应用自有目录都没有可执行文件），请完成 SDK 引导'
  )
}

export interface SharedServerDescriptor {
  /** 复用既有 server；false = 由本应用选定 adb 启动的新标准 server */
  reused: boolean
  protocolVersion: number
}

export interface EnsureServerDeps extends ProbeDeps {
  run?: typeof runAdb
}

/**
 * 与宿主共享 adb server 的存续策略：
 * 已在跑且协议相容 → 复用（构建版本差异不影响 server 语义）；不相容 → 拦截报错，
 * 绝不 kill-server 换自己的；没在跑 → 用选定 adb 启动标准 server 后复验。
 */
export async function ensureSharedServer(
  exec: AdbExecutable,
  deps: EnsureServerDeps = {}
): Promise<SharedServerDescriptor> {
  const run = deps.run ?? runAdb
  const probe = await probeServer(deps)
  if (probe.running) {
    if (probe.protocolVersion !== exec.protocolVersion) {
      throw new Error(
        `共享 adb server 协议版本不兼容（运行中 ${probe.protocolVersion} / 本应用 adb ${exec.protocolVersion}）。` +
          '请关闭占用 adb server 的程序后重试；本应用不会自动重启共享 server。'
      )
    }
    return { reused: true, protocolVersion: probe.protocolVersion }
  }
  const started = await run(exec.path, ['start-server'], { timeoutMs: 30_000 })
  if (started.code !== 0) {
    throw new Error(`adb start-server 失败：${started.stderr || `exit ${started.code}`}`)
  }
  const again = await probeServer(deps)
  if (!again.running || again.protocolVersion !== exec.protocolVersion) {
    throw new Error('adb start-server 后仍探测不到相容的共享 server（127.0.0.1:5037）')
  }
  return { reused: false, protocolVersion: again.protocolVersion }
}

/** 共享 server 已登记的设备 serial 集（`adb devices` 的 device 态行） */
export async function listAdbSerials(adbPath: string): Promise<Set<string>> {
  const result = await runAdb(adbPath, ['devices'], { timeoutMs: 10_000 })
  if (result.code !== 0) {
    throw new Error(`adb devices 失败：${result.stderr || `exit ${result.code}`}`)
  }
  const serials = new Set<string>()
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\tdevice\r?$/.exec(line.trim())
    if (match) serials.add(match[1])
  }
  return serials
}
