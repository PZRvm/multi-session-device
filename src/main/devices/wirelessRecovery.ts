import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { connect } from 'node:net'
import type { WirelessConnectInput, WirelessConnectOutcome } from '@shared/types'
import type {
  WirelessDiagnosis,
  WirelessRecoveryState,
  WirelessRepairOutcome
} from '@shared/wirelessRecovery'
import { WIRELESS_RECOVERY_COPY } from '@shared/wirelessRecovery'
import { getLocaleState } from '../locale/store'
import { adbRecovery } from '../emulator/adbRecovery'
import type { AdbRunResult } from '../emulator/adb'

type Run = (args: string[], timeout?: number) => Promise<AdbRunResult>
type Entry = {
  owner: number
  created: number
  target?: WirelessConnectInput
  diagnosis: WirelessDiagnosis
  repairable: boolean
}
export interface RecoveryDeps {
  run: Run
  connect: (target: WirelessConnectInput, run: Run) => Promise<WirelessConnectOutcome>
  busy: () => string[]
  confirm: (owner: number) => Promise<boolean>
  alive: (owner: number) => boolean
  suspend: () => Promise<void>
  resume: () => Promise<void>
  restart: () => Promise<void>
  changed: (state: WirelessRecoveryState) => void
  copy: (text: string) => void
  probe?: typeof probeWirelessTcp
}
export function sanitizeWirelessDetail(value: string): string {
  return value
    .replaceAll(homedir(), '~')
    .replace(/(?:[A-Za-z]:)?[^\s"']*\.(?:apk|pem|key)\b/gi, '[redacted]')
    .replace(/\b(?:pairing[_ -]?code|password|token|secret)\s*[:=]\s*\S+/gi, '[redacted]')
    .slice(0, 1200)
}
export function classifyWirelessFailure(
  tcp: WirelessDiagnosis['tcp'],
  detail: string,
  stage: string
): WirelessDiagnosis['kind'] {
  if (stage === 'tcpip') return 'tcpip'
  if (stage === 'shell') return 'verification'
  if (tcp === 'reachable') return 'service-suspected'
  if (tcp === 'refused' || /refused/i.test(detail)) return 'refused'
  if (
    tcp === 'blocked' ||
    tcp === 'timeout' ||
    /no route|timed? out|unreachable|denied/i.test(detail)
  )
    return 'network'
  return 'unknown'
}
export function probeWirelessTcp(host: string, port: number): Promise<WirelessDiagnosis['tcp']> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (state: WirelessDiagnosis['tcp']): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(state)
    }
    const timer = setTimeout(() => finish('timeout'), 1500)
    socket.once('connect', () => finish('reachable'))
    socket.once('error', (error: NodeJS.ErrnoException) =>
      finish(
        error.code === 'ECONNREFUSED'
          ? 'refused'
          : ['EHOSTUNREACH', 'ENETUNREACH', 'EACCES', 'EPERM'].includes(error.code ?? '')
            ? 'blocked'
            : 'unknown'
      )
    )
  })
}

/** Attempts are ephemeral, window-owned and bounded. No pairing input is recorded. */
export class WirelessRecovery {
  private attempts = new Map<string, Entry>()
  private phase: WirelessRecoveryState['phase'] = 'idle'
  private operations = 0
  constructor(private readonly deps: RecoveryDeps) {}
  private copy(): (typeof WIRELESS_RECOVERY_COPY)['zh-CN'] {
    return WIRELESS_RECOVERY_COPY[getLocaleState()]
  }
  state(): WirelessRecoveryState {
    return { phase: this.phase, blocked: this.deps.busy() }
  }
  private publish(phase: WirelessRecoveryState['phase']): void {
    this.phase = phase
    this.deps.changed(this.state())
  }
  forget(owner: number): void {
    for (const [id, item] of this.attempts) if (item.owner === owner) this.attempts.delete(id)
  }
  private entry(id: string, owner: number): Entry {
    const entry = this.attempts.get(id)
    if (!entry || entry.owner !== owner || Date.now() - entry.created > 600_000) {
      if (entry && Date.now() - entry.created > 600_000) this.attempts.delete(id)
      throw new Error(this.copy().expired)
    }
    return entry
  }
  async attempt(
    owner: number,
    action: (run: Run) => Promise<WirelessConnectOutcome>
  ): Promise<WirelessConnectOutcome> {
    adbRecovery.assertOpen()
    this.operations++
    let target: WirelessConnectInput | undefined
    let stage = 'connect'
    let last: AdbRunResult = { code: -1, stdout: '', stderr: '' }
    const run: Run = async (args, timeout) => {
      adbRecovery.assertOpen()
      if (args[0] === 'connect') {
        const [host, port] = args[1].split(':')
        target = { host, port: Number(port) || 5555 }
      }
      stage = args.includes('tcpip')
        ? 'tcpip'
        : args.includes('route')
          ? 'route'
          : args.includes('shell')
            ? 'shell'
            : args[0] === 'devices'
              ? 'transport'
              : 'connect'
      try {
        last = await this.deps.run(args, timeout)
        return last
      } catch (error) {
        last = { code: -1, stdout: '', stderr: String(error) }
        throw error
      }
    }
    try {
      let result: WirelessConnectOutcome
      try {
        result = await action(run)
      } catch {
        result = { ok: false, reason: 'unreachable', host: target?.host ?? '' }
      }
      if (result.ok) {
        stage = 'shell'
        try {
          const check = await run(
            ['-s', result.serial, 'shell', 'echo', 'msd-wireless-ready'],
            5000
          )
          if (check.code === 0 && check.stdout.trim() === 'msd-wireless-ready') return result
        } catch {
          /* preserve evidence */
        }
        result = { ok: false, reason: 'offline-race', host: target?.host ?? result.serial }
      }
      if (!this.deps.alive(owner)) return result
      const [tcp, version, server] = await Promise.all([
        target
          ? (this.deps.probe ?? probeWirelessTcp)(target.host, target.port ?? 5555).catch(
              () => 'unknown' as const
            )
          : Promise.resolve('unknown' as const),
        this.deps.run(['version'], 1500).catch(() => undefined),
        this.deps.run(['server-status'], 1500).catch(() => undefined)
      ])
      const diagnosis: WirelessDiagnosis = {
        tcp,
        stage,
        code: last.code,
        adbVersion: version?.code === 0 ? sanitizeWirelessDetail(version.stdout) : undefined,
        server: server?.code === 0 ? sanitizeWirelessDetail(server.stdout) : undefined,
        detail: sanitizeWirelessDetail(last.stderr || last.stdout),
        kind: classifyWirelessFailure(tcp, last.stderr || last.stdout, stage)
      }
      const id = randomUUID()
      // Keep concurrent attempts independent; completion order must not expire a newer result.
      for (const [key, value] of this.attempts)
        if (Date.now() - value.created > 600_000) this.attempts.delete(key)
      if (this.attempts.size >= 32) this.attempts.delete(this.attempts.keys().next().value!)
      const repairable =
        !!target && !['unauthorized', 'no-wifi', 'not-found'].includes(result.reason)
      this.attempts.set(id, { owner, created: Date.now(), target, diagnosis, repairable })
      return {
        ...result,
        diagnosis,
        attemptId: id,
        repairable
      }
    } finally {
      this.operations--
    }
  }
  copyDiagnostics(id: string, owner: number): void {
    const entry = this.entry(id, owner)
    this.deps.copy(JSON.stringify({ target: entry.target, ...entry.diagnosis }, null, 2))
  }
  async repair(id: string, owner: number): Promise<WirelessRepairOutcome> {
    const entry = this.entry(id, owner)
    if (!entry.target || !entry.repairable) return { ok: false, message: this.copy().expired }
    const release = adbRecovery.reserve()
    let suspended = false
    let result: WirelessRepairOutcome
    try {
      this.publish('confirming')
      const initial = this.deps.busy()
      if (initial.length) return { ok: false, message: this.copy().task + initial.join(', ') }
      if (!(await this.deps.confirm(owner)) || !this.deps.alive(owner))
        return { ok: false, message: '', cancelled: true }
      adbRecovery.lock()
      const blocked = this.deps.busy()
      if (blocked.length) return { ok: false, message: this.copy().task + blocked.join(', ') }
      if (this.operations) return { ok: false, message: this.copy().commands }
      this.publish('restarting')
      suspended = true
      await this.deps.suspend()
      const deadline = Date.now() + 5000
      while (adbRecovery.pending && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50))
      if (adbRecovery.pending) return { ok: false, message: this.copy().commands }
      result = await adbRecovery.asOwner(async () => {
        await this.deps.restart()
        this.publish('reconnecting')
        const repairRun: Run = async (args, timeout) => {
          try {
            const output = await this.deps.run(args, timeout)
            entry.diagnosis = {
              ...entry.diagnosis,
              stage: args.includes('shell') ? 'shell' : args[0],
              code: output.code,
              detail: sanitizeWirelessDetail(output.stderr || output.stdout)
            }
            return output
          } catch (error) {
            entry.diagnosis = {
              ...entry.diagnosis,
              code: -1,
              detail: sanitizeWirelessDetail(String(error))
            }
            throw error
          }
        }
        const connection = await this.deps.connect(entry.target!, repairRun)
        if (!connection.ok)
          return { ok: false as const, message: this.copy().failed + this.copy().unknown }
        const checked = await repairRun(
          ['-s', connection.serial, 'shell', 'echo', 'msd-wireless-ready'],
          5000
        )
        if (checked.code !== 0 || checked.stdout.trim() !== 'msd-wireless-ready')
          return { ok: false as const, message: this.copy().verification }
        return connection
      })
      return result
    } catch (error) {
      return { ok: false, message: this.copy().failed + sanitizeWirelessDetail(String(error)) }
    } finally {
      adbRecovery.unlock()
      try {
        if (suspended) await this.deps.resume()
      } finally {
        release()
        this.publish('idle')
      }
    }
  }
}
