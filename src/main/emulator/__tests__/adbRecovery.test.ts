import { afterEach, expect, it } from 'vitest'
import { AdbRecoveryGate } from '../adbRecovery'

afterEach(() => {})
it('exclusive recovery blocks new work but lets its owner run; failures always release', async () => {
  const gate = new AdbRecoveryGate()
  const release = gate.reserve()
  expect(() => gate.reserve()).toThrow()
  gate.lock()
  expect(() => gate.assertOpen()).toThrow()
  await expect(
    gate.asOwner(async () => {
      gate.assertOpen()
      throw new Error('start failed')
    })
  ).rejects.toThrow('start failed')
  release()
  expect(() => gate.assertOpen()).not.toThrow()
})
it('drains existing commands before restarting, never starts work while locked', async () => {
  const gate = new AdbRecoveryGate()
  const done = gate.command()
  const release = gate.reserve()
  gate.lock()
  expect(gate.pending).toBe(1)
  expect(() => gate.command()).toThrow()
  done()
  expect(gate.pending).toBe(0)
  release()
})
it('SDK mutation activity is registered before awaits and removed after rejection', async () => {
  const gate = new AdbRecoveryGate()
  let fail!: (error: Error) => void
  const pending = gate.activity(
    'sdk-source',
    () =>
      new Promise((_, reject) => {
        fail = reject
      })
  )
  expect(gate.blockers).toEqual(['sdk-source'])
  fail(new Error('migration failed'))
  await expect(pending).rejects.toThrow('migration failed')
  expect(gate.blockers).toEqual([])
})
