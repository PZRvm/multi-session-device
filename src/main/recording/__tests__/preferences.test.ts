// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { audioPromptCondition, RecordingPreferences, recordingPromptKey } from '../preferences'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const setup = async (): Promise<RecordingPreferences> => {
  const root = await mkdtemp(join(tmpdir(), 'msd-recording-preferences-'))
  roots.push(root)
  return new RecordingPreferences(join(root, 'prompts.json'))
}
it('persists only the matching device, prompt kind and condition across restart', async () => {
  const prefs = await setup()
  const key = recordingPromptKey('physical:A', 'silent', 'sdk:31')
  await prefs.ready()
  await prefs.remember(key, prefs.epoch)
  const restored = new RecordingPreferences(prefs.path)
  expect(await restored.has(key)).toBe(true)
  expect(await restored.has(recordingPromptKey('physical:B', 'silent', 'sdk:31'))).toBe(false)
  expect(await restored.has(recordingPromptKey('physical:A', 'silent', 'sdk:32'))).toBe(false)
  expect(await restored.has(recordingPromptKey('physical:A', 'capture-size', 'sdk:31'))).toBe(false)
})
it('reset wins over a late checkbox response and concurrent writes survive restart', async () => {
  const prefs = await setup()
  await prefs.ready()
  const epoch = prefs.epoch
  await Promise.all(
    ['a', 'b'].map((id) => prefs.remember(recordingPromptKey(id, 'silent', 'sdk:31'), epoch))
  )
  const beforeReset = new RecordingPreferences(prefs.path)
  for (const id of ['a', 'b'])
    expect(await beforeReset.has(recordingPromptKey(id, 'silent', 'sdk:31'))).toBe(true)
  await prefs.reset()
  await prefs.remember(recordingPromptKey('late', 'silent', 'sdk:31'), epoch)
  const restored = new RecordingPreferences(prefs.path)
  for (const id of ['a', 'b', 'late'])
    expect(await restored.has(recordingPromptKey(id, 'silent', 'sdk:31'))).toBe(false)
})

it('does not remember an unknown SDK or unclassified transient error', () => {
  expect(audioPromptCondition('', 'property lookup failed')).toBeUndefined()
  expect(audioPromptCondition('34', 'unexpected transport failure')).toBeUndefined()
  expect(audioPromptCondition('31', 'Android SDK 31')).toBe('sdk:31')
  expect(audioPromptCondition('34', 'Audio connection timed out: pid=12')).toBe(
    audioPromptCondition('34', 'Audio connection timed out: pid=98')
  )
  expect(audioPromptCondition('34', 'permission denied')).not.toBe(
    audioPromptCondition('34', 'Audio metadata timed out')
  )
})
