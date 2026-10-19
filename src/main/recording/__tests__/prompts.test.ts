// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ dialog: { showMessageBox: native } }))
vi.mock('../../app-icon', () => ({ appIcon: {} }))
import { RecordingPreferences, recordingPromptKey } from '../preferences'
import { createRecordingConfirm } from '../prompts'
const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const setup = async (): Promise<{
  prefs: RecordingPreferences
  confirm: ReturnType<typeof createRecordingConfirm>
  key: string
}> => {
  const root = await mkdtemp(join(tmpdir(), 'msd-recording-confirm-'))
  roots.push(root)
  const prefs = new RecordingPreferences(join(root, 'prompts.json'))
  await prefs.ready()
  return {
    prefs,
    confirm: createRecordingConfirm(prefs, () => null),
    key: recordingPromptKey('a', 'silent', 'sdk:31')
  }
}
it('only remembers a checked affirmative choice; the next matched request skips the native dialog', async () => {
  const { prefs, confirm, key } = await setup()
  const context = { key, valid: () => true }
  native.mockResolvedValueOnce({ response: 1, checkboxChecked: true })
  expect(await confirm('silent', { reason: 'SDK 31' }, context)).toBe(false)
  expect(await prefs.has(key)).toBe(false)
  native.mockResolvedValueOnce({ response: 0, checkboxChecked: true })
  expect(await confirm('silent', {}, context)).toBe(true)
  expect(native.mock.calls[1][0]).toMatchObject({
    checkboxChecked: false,
    checkboxLabel: expect.any(String)
  })
  expect(await confirm('silent', {}, context)).toBe(true)
  expect(native).toHaveBeenCalledTimes(2)
})
it('does not remember a late answer after the task stopped or after restoring prompts', async () => {
  const { prefs, confirm, key } = await setup()
  let valid = true
  let accept!: (value: { response: number; checkboxChecked: boolean }) => void
  native.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve
      })
  )
  const first = confirm('silent', {}, { key, valid: () => valid })
  await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(1))
  valid = false
  accept({ response: 0, checkboxChecked: true })
  expect(await first).toBe(false)
  expect(await prefs.has(key)).toBe(false)
  valid = true
  const second = confirm('silent', {}, { key, valid: () => valid })
  await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(2))
  await prefs.reset()
  accept({ response: 0, checkboxChecked: true })
  expect(await second).toBe(true)
  expect(await prefs.has(key)).toBe(false)
})
