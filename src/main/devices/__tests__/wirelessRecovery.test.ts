// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import {
  WirelessRecovery,
  classifyWirelessFailure,
  sanitizeWirelessDetail,
  type RecoveryDeps
} from '../wirelessRecovery'
import { adbRecovery } from '../../emulator/adbRecovery'
vi.mock('electron', () => ({ app: {} }))
const ok = (stdout = ''): { code: number; stdout: string; stderr: string } => ({
  code: 0,
  stdout,
  stderr: ''
})
const setup = (
  overrides: Partial<RecoveryDeps> = {}
): { service: WirelessRecovery; deps: RecoveryDeps } => {
  const deps: RecoveryDeps = {
    run: vi.fn(async () => ok('msd-wireless-ready')),
    connect: vi.fn(async () => ({ ok: true as const, serial: '192.168.31.162:5555' })),
    busy: () => [],
    confirm: vi.fn(async () => true),
    alive: () => true,
    suspend: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    changed: vi.fn(),
    copy: vi.fn(),
    probe: vi.fn(async () => 'reachable' as const),
    ...overrides
  }
  return { service: new WirelessRecovery(deps), deps }
}
async function failure(
  service: WirelessRecovery
): Promise<Extract<import('@shared/types').WirelessConnectOutcome, { ok: false }>> {
  const result = await service.attempt(1, async (run) => {
    await run(['connect', '192.168.31.162:5555'], 100)
    return { ok: false, reason: 'unreachable', host: '192.168.31.162' }
  })
  if (result.ok || !result.attemptId) throw new Error('missing diagnostic')
  return result
}
afterEach(() => expect(adbRecovery.active).toBe(false))
it('diagnoses port reachable while ADB fails, never silently restarts', async () => {
  const { service, deps } = setup({
    run: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'No route to host' }))
  })
  const result = await failure(service)
  expect(result.diagnosis?.kind).toBe('service-suspected')
  expect(deps.restart).not.toHaveBeenCalled()
  service.copyDiagnostics(result.attemptId!, 1)
  expect(deps.copy).toHaveBeenCalled()
  expect(() => service.copyDiagnostics(result.attemptId!, 2)).toThrow()
})
it('cancel has no restart and no suspend', async () => {
  const { service, deps } = setup({ confirm: async () => false })
  const result = await failure(service)
  expect(await service.repair(result.attemptId!, 1)).toMatchObject({ cancelled: true })
  expect(deps.restart).not.toHaveBeenCalled()
  expect(deps.suspend).not.toHaveBeenCalled()
})
it('rechecks tasks after confirmation before touching the service', async () => {
  let blocked = false
  const { service, deps } = setup({
    busy: () => (blocked ? ['install'] : []),
    confirm: async () => {
      blocked = true
      return true
    }
  })
  const result = await failure(service)
  expect(await service.repair(result.attemptId!, 1)).toMatchObject({
    ok: false,
    message: expect.stringContaining('install')
  })
  expect(deps.restart).not.toHaveBeenCalled()
})
it('repairs once, verifies shell and releases on restart failure', async () => {
  const { service, deps } = setup()
  const result = await failure(service)
  expect(await service.repair(result.attemptId!, 1)).toMatchObject({ ok: true })
  expect(deps.restart).toHaveBeenCalledTimes(1)
  vi.mocked(deps.restart).mockRejectedValueOnce(new Error('start failed'))
  expect(await service.repair(result.attemptId!, 1)).toMatchObject({
    ok: false,
    message: expect.stringContaining('start failed')
  })
  expect(deps.resume).toHaveBeenCalledTimes(2)
  expect(service.state().phase).toBe('idle')
})
it('rejects a second repair while confirmation is pending', async () => {
  let finish!: (value: boolean) => void
  const { service, deps } = setup({
    confirm: () =>
      new Promise((resolve) => {
        finish = resolve
      })
  })
  const result = await failure(service)
  const first = service.repair(result.attemptId!, 1)
  await expect(service.repair(result.attemptId!, 1)).rejects.toThrow()
  finish(false)
  await first
  expect(deps.restart).not.toHaveBeenCalled()
})
it('does not claim successful connection until shell is verified', async () => {
  const { service } = setup({ run: async () => ok('unexpected') })
  expect(
    await service.attempt(1, async () => ({ ok: true as const, serial: '192.168.31.162:5555' }))
  ).toMatchObject({ ok: false, diagnosis: { kind: 'verification' } })
})
it('expires attempt contexts and refuses destroyed owners', async () => {
  const { service, deps } = setup()
  const result = await failure(service)
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 600_001)
  await expect(service.repair(result.attemptId!, 1)).rejects.toThrow()
  clock.mockRestore()
  expect(deps.restart).not.toHaveBeenCalled()
})
it('network evidence and secret redaction are conservative', () => {
  expect(classifyWirelessFailure('unknown', 'No route to host', 'connect')).toBe('network')
  expect(classifyWirelessFailure('refused', '', 'connect')).toBe('refused')
  expect(classifyWirelessFailure('reachable', '', 'tcpip')).toBe('tcpip')
  expect(sanitizeWirelessDetail('password=abc /tmp/demo.apk')).not.toContain('abc')
  expect(sanitizeWirelessDetail('/tmp/demo.apk')).not.toContain('demo.apk')
})

it('unauthorized attempts cannot restart even with a forged direct repair request', async () => {
  const { service, deps } = setup()
  const result = await service.attempt(1, async (run) => {
    await run(['connect', '192.168.31.162:5555'])
    return { ok: false, reason: 'unauthorized', host: '192.168.31.162' }
  })
  if (result.ok) throw new Error('expected unauthorized')
  expect(result.repairable).toBe(false)
  await expect(service.repair(result.attemptId!, 1)).resolves.toMatchObject({ ok: false })
  expect(deps.confirm).not.toHaveBeenCalled()
  expect(deps.restart).not.toHaveBeenCalled()
})
it('a closing owner during confirmation leaves the service alone', async () => {
  let alive = true
  const { service, deps } = setup({
    alive: () => alive,
    confirm: async () => {
      alive = false
      return true
    }
  })
  const result = await failure(service)
  await expect(service.repair(result.attemptId!, 1)).resolves.toMatchObject({ cancelled: true })
  expect(deps.restart).not.toHaveBeenCalled()
})
it('does not repair while a second normal connection is in progress', async () => {
  const { service, deps } = setup()
  const result = await failure(service)
  let finish!: () => void
  const pending = service.attempt(2, async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return { ok: false, reason: 'no-wifi', host: 'USB' }
  })
  await expect(service.repair(result.attemptId!, 1)).resolves.toMatchObject({ ok: false })
  expect(deps.restart).not.toHaveBeenCalled()
  finish()
  await pending
})

it('a slower earlier attempt cannot invalidate the latest visible diagnostics', async () => {
  const { service, deps } = setup()
  let finish!: () => void
  const older = service.attempt(1, async (run) => {
    await run(['connect', '192.168.31.161:5555'])
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return { ok: false, reason: 'unreachable', host: '192.168.31.161' }
  })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const latest = await failure(service)
  service.copyDiagnostics(latest.attemptId!, 1)
  finish()
  const previous = await older
  expect(() => service.copyDiagnostics(latest.attemptId!, 1)).not.toThrow()
  expect(deps.copy).toHaveBeenLastCalledWith(expect.stringContaining('192.168.31.162'))
  await expect(service.repair(latest.attemptId!, 1)).resolves.toMatchObject({ ok: true })
  service.forget(1)
  expect(() => service.copyDiagnostics(latest.attemptId!, 1)).toThrow()
  if (previous.ok) throw new Error('expected failed attempt')
  expect(() => service.copyDiagnostics(previous.attemptId!, 1)).toThrow()
})
