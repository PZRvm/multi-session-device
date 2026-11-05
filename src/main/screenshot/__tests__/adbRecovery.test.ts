// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { adbRecovery } from '../../emulator/adbRecovery'
import { runAdbBinary } from '../index'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('electron', () => ({ app: {}, clipboard: {}, ipcMain: {}, nativeImage: {} }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../../locale', () => ({ msg: (key: string) => key }))
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}
afterEach(() => {
  vi.useRealTimers()
  mocks.spawn.mockReset()
  expect(adbRecovery.pending).toBe(0)
})
it('locked repair refuses a new screenshot before spawning', async () => {
  const child = new FakeChild()
  mocks.spawn.mockReturnValue(child)
  const release = adbRecovery.reserve()
  adbRecovery.lock()
  try {
    const operation = runAdbBinary('/adb', ['exec-out', 'screencap', '-p'])
    child.emit('close', 0)
    await expect(operation).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  } finally {
    release()
  }
})
it('an in-flight screenshot stays counted until close, including after timeout', async () => {
  vi.useFakeTimers()
  const child = new FakeChild()
  mocks.spawn.mockReturnValue(child)
  const operation = runAdbBinary('/adb', ['exec-out'], { timeoutMs: 10 })
  try {
    expect(adbRecovery.pending).toBe(1)
    await vi.advanceTimersByTimeAsync(10)
    await expect(operation).resolves.toMatchObject({ code: -1 })
    expect(adbRecovery.pending).toBe(1)
  } finally {
    child.emit('close', 0)
    await operation
  }
  expect(adbRecovery.pending).toBe(0)
})
it('spawn failures and error followed by close release the command exactly once', async () => {
  mocks.spawn.mockImplementationOnce(() => {
    throw new Error('spawn failed')
  })
  await expect(runAdbBinary('/adb', [])).rejects.toThrow('spawn failed')
  expect(adbRecovery.pending).toBe(0)
  const child = new FakeChild()
  mocks.spawn.mockReturnValue(child)
  const operation = runAdbBinary('/adb', [])
  child.emit('error', new Error('child failed'))
  child.emit('close', 1)
  await expect(operation).rejects.toThrow('child failed')
  expect(adbRecovery.pending).toBe(0)
})
