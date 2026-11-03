// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import type { RecordingTask } from '@shared/recording'
import { RecordingNotifications } from '../notifications'
const task = (id: string, state: RecordingTask['state'] = 'saved'): RecordingTask => ({
  taskId: id,
  deviceId: id,
  deviceName: id,
  state,
  audio: 'silent',
  durationMs: 1000,
  bytes: 100,
  width: 1080,
  height: 2400,
  progress: 1,
  canRetry: state === 'error'
})
const services: RecordingNotifications[] = []
afterEach(() => {
  services.splice(0).forEach((service) => service.dispose())
  vi.useRealTimers()
})
it('defers to a visible main window, serializes results, and never deletes deferred failure media', async () => {
  vi.useFakeTimers()
  let visible = false
  let finish!: (value: 'close') => void
  const present = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    .mockResolvedValue('later')
  const command = vi.fn(async () => undefined)
  const service = new RecordingNotifications({
    canShow: () => visible,
    present,
    command,
    failed: vi.fn()
  })
  services.push(service)
  const snapshot = { revision: 1, limit: 2, tasks: [task('a'), task('b', 'error')] }
  service.update(snapshot)
  await vi.advanceTimersByTimeAsync(200)
  expect(present).not.toHaveBeenCalled()
  visible = true
  await vi.advanceTimersByTimeAsync(1000)
  expect(present).toHaveBeenCalledTimes(1)
  service.update(snapshot)
  finish('close')
  await vi.advanceTimersByTimeAsync(100)
  expect(present).toHaveBeenCalledTimes(2)
  expect(command.mock.calls).toEqual([['a', 'dismiss']])
  service.update(snapshot)
  await vi.advanceTimersByTimeAsync(200)
  expect(present).toHaveBeenCalledTimes(2)
})
it('reoffers a result after the owner closes, pauses on quit, and reports a failed retry again', async () => {
  vi.useFakeTimers()
  const present = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce('later')
    .mockResolvedValue('later')
  const service = new RecordingNotifications({
    canShow: () => true,
    present,
    command: vi.fn(),
    failed: vi.fn()
  })
  services.push(service)
  const update = (state: RecordingTask['state']): void =>
    service.update({ revision: 1, limit: 2, tasks: [task('a', state)] })
  service.pause(true)
  update('error')
  await vi.advanceTimersByTimeAsync(200)
  expect(present).not.toHaveBeenCalled()
  service.pause(false)
  await vi.advanceTimersByTimeAsync(200)
  expect(present).toHaveBeenCalledTimes(2)
  update('processing')
  update('error')
  await vi.advanceTimersByTimeAsync(100)
  expect(present).toHaveBeenCalledTimes(3)
})

it('retains the notification if the native sheet rejects while its owner closes', async () => {
  vi.useFakeTimers()
  let visible = true
  const present = vi
    .fn()
    .mockImplementationOnce(async () => {
      visible = false
      throw new Error('owner closed')
    })
    .mockResolvedValue('later')
  const failed = vi.fn()
  const service = new RecordingNotifications({
    canShow: () => visible,
    present,
    failed,
    command: vi.fn()
  })
  services.push(service)
  const snapshot = { revision: 1, limit: 2, tasks: [task('a', 'error')] }
  service.update(snapshot)
  await vi.advanceTimersByTimeAsync(200)
  expect(present).toHaveBeenCalledTimes(1)
  expect(failed).not.toHaveBeenCalled()
  visible = true
  service.update(snapshot)
  await vi.advanceTimersByTimeAsync(1000)
  expect(present).toHaveBeenCalledTimes(2)
})
