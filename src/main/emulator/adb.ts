import { connect as tcpConnect, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { msg } from '../locale'
import { adbRecovery } from './adbRecovery'

/** 共享 adb server 锁定本机默认 endpoint——不读宿主传入的远端配置 */
export const ADB_HOST = '127.0.0.1'
export const ADB_SERVER_PORT = 5037
export const ADB_PROBE_TIMEOUT_MS = 3_000

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

// 真机 track 客户端（devices/external）复用同一 connect 接缝（plan 2026-10-13-real-device-usb-and-apk-install）
export { tcpConnect }

/**
 * 只读探测共享 adb server（host:version 查询后立即断开）：
 * 不 start-server、不 kill-server——重启共享 server 的决定权永远不在这里。
 */
export async function probeServer(deps: ProbeDeps = {}): Promise<ServerProbe> {
  const connect = deps.connect ?? tcpConnect
  return new Promise<ServerProbe>((resolve) => {
    let socket: Socket | undefined
    let finished = false
    const finish = (probe: ServerProbe): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket?.off('connect', onConnect)
      socket?.off('data', onData)
      socket?.off('end', onFailure)
      socket?.off('close', onFailure)
      socket?.off('error', onFailure)
      socket?.destroy()
      resolve(probe)
    }
    const onFailure = (): void => finish({ running: false })
    // 总期限包含连接建立；持续到达的碎片不能像 socket inactivity timeout 一样续期。
    const timer = setTimeout(onFailure, ADB_PROBE_TIMEOUT_MS)
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      // 应答：OKAY/FAIL + 4 位长度 + 载荷
      if (buffer.length >= 4 && buffer.subarray(0, 4).toString('utf8') !== 'OKAY') {
        return onFailure()
      }
      if (buffer.length < 8) return
      const lengthText = buffer.subarray(4, 8).toString('utf8')
      if (!/^[\da-f]{4}$/i.test(lengthText)) return onFailure()
      const length = Number.parseInt(lengthText, 16)
      if (buffer.length < 8 + length) return
      const payload = buffer.subarray(8, 8 + length).toString('utf8')
      const protocolVersion = parseAdbVersionPayload(payload)
      finish(protocolVersion === null ? { running: false } : { running: true, protocolVersion })
    }
    const onConnect = (): void => {
      try {
        socket?.write(encodeAdbRequest('host:version'))
      } catch {
        onFailure()
      }
    }
    try {
      socket = connect({ host: ADB_HOST, port: ADB_SERVER_PORT })
      socket.once('connect', onConnect)
      socket.on('data', onData)
      socket.once('end', onFailure)
      socket.once('close', onFailure)
      socket.once('error', onFailure)
    } catch {
      onFailure()
    }
  })
}

// ---- 可执行文件解析与命令执行 ----

export interface AdbExecutable {
  path: string
  source: 'path' | 'standard-sdk' | 'app-sdk'
  /** `adb version` 首行的协议版本号（1.0.41 → 41） */
  protocolVersion: number
}

export interface AdbCandidateDeps {
  /** 环境变量（默认 process.env——win32 用 LOCALAPPDATA 定位标准 SDK） */
  env?: Record<string, string | undefined>
  /** 主目录（默认 os.homedir） */
  homedir?: () => string
  /** 平台（默认 process.platform；win32 用 `;` 分隔 PATH、`adb.exe` 后缀与 %LOCALAPPDATA% 布局） */
  platform?: NodeJS.Platform
}

/** 用户已有 platform-tools 优先（PATH → 标准 SDK 候选），应用自有 adb 兜底 */
export function candidateAdbPaths(
  appSdkRoot: string,
  deps: AdbCandidateDeps = {}
): Array<{ path: string; source: AdbExecutable['source'] }> {
  const env = deps.env ?? process.env
  const home = (deps.homedir ?? homedir)()
  const isWin = (deps.platform ?? process.platform) === 'win32'
  const adbName = isWin ? 'adb.exe' : 'adb'
  const candidates: Array<{ path: string; source: AdbExecutable['source'] }> = []
  for (const dir of (env['PATH'] ?? '').split(isWin ? ';' : ':')) {
    if (dir.length > 0) candidates.push({ path: join(dir, adbName), source: 'path' })
  }
  candidates.push(
    isWin
      ? {
          // Windows 标准 SDK：%LOCALAPPDATA%\Android\Sdk（缺失时按 homedir 推 AppData\Local）
          path: join(
            env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local'),
            'Android',
            'Sdk',
            'platform-tools',
            adbName
          ),
          source: 'standard-sdk'
        }
      : {
          path: join(home, 'Library', 'Android', 'sdk', 'platform-tools', adbName),
          source: 'standard-sdk'
        }
  )
  candidates.push({ path: join(appSdkRoot, 'platform-tools', adbName), source: 'app-sdk' })
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
  { timeoutMs = 10_000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<AdbRunResult> {
  if (signal?.aborted) throw new Error(msg('adbOperationCancelled'))
  const finishCommand = adbRecovery.command()
  return new Promise<AdbRunResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(adbPath, args, { env: scrubAdbEnv(process.env), windowsHide: true })
    } catch (error) {
      finishCommand()
      reject(error)
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    const abort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', abort, { once: true })
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            settled = true
            child.kill('SIGKILL')
            resolve({
              code: -1,
              stdout: Buffer.concat(out).toString('utf8'),
              stderr: msg('adbCommandTimeout', { args: args.join(' '), ms: timeoutMs })
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
      finishCommand()
      signal?.removeEventListener('abort', abort)
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      finishCommand()
      signal?.removeEventListener('abort', abort)
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
  throw new Error(msg('adbNotFound'))
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
        msg('adbProtocolIncompatible', {
          running: probe.protocolVersion ?? -1,
          ours: exec.protocolVersion ?? -1
        }) + msg('adbServerOccupied')
      )
    }
    return { reused: true, protocolVersion: probe.protocolVersion }
  }
  const started = await run(exec.path, ['start-server'], { timeoutMs: 30_000 })
  if (started.code !== 0) {
    throw new Error(msg('adbStartFailed', { detail: started.stderr || `exit ${started.code}` }))
  }
  const again = await probeServer(deps)
  if (!again.running || again.protocolVersion !== exec.protocolVersion) {
    throw new Error(msg('adbSharedServerMissing'))
  }
  return { reused: false, protocolVersion: again.protocolVersion }
}

/** 共享 server 已登记的设备 serial 集（`adb devices` 的 device 态行） */
export async function listAdbSerials(adbPath: string): Promise<Set<string>> {
  const result = await runAdb(adbPath, ['devices'], { timeoutMs: 10_000 })
  if (result.code !== 0) {
    throw new Error(msg('adbDevicesFailed', { detail: result.stderr || `exit ${result.code}` }))
  }
  const serials = new Set<string>()
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\tdevice\r?$/.exec(line.trim())
    if (match) serials.add(match[1])
  }
  return serials
}
