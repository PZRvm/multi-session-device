// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SegmentStore, mediaRecords } from '../segments'
import { publishRecording, recordingBaseName } from '../publish'
import { RecordingCapture } from '../capture'
import { videoFrames } from '../source'
import type { RecordingTask } from '@shared/recording'
vi.mock('electron', () => ({ app: {} }))
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})
const temp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'msd-media-'))
  directories.push(dir)
  return dir
}
// 自制闪光短音 fixture 的 H.264 SPS/PPS（1080×2400），无用户画面。
const configuration = Buffer.from(
  '000000016742c0328d68044012de5e420202020f08846a0000000168ce01a835c8',
  'hex'
)
const view = (): RecordingTask => ({
  taskId: 'id',
  deviceId: 'device',
  deviceName: 'Device',
  state: 'starting',
  audio: 'silent',
  durationMs: 0,
  bytes: 0,
  width: 0,
  height: 0,
  progress: 0
})
describe('recording media files', () => {
  it('keeps raw bigint timestamps and fails explicitly on a corrupt tail', async () => {
    const directory = await temp()
    const store = await SegmentStore.create(directory, () => undefined)
    const record = {
      config: false,
      keyframe: true,
      segment: 7,
      pts: 42_000_000_000n,
      rawPts: 42_000_123_456n,
      received: 21_000_000n,
      data: Uint8Array.of(1, 2, 3)
    }
    store.append('audio', record)
    await store.close()
    const records: import('../segments').MediaRecord[] = []
    for await (const packet of mediaRecords(join(directory, 'audio.bin'))) records.push(packet)
    expect(records.map((entry) => ({ ...entry, data: Array.from(entry.data) }))).toEqual([
      { ...record, data: Array.from(record.data) }
    ])
    const bytes = await readFile(join(directory, 'audio.bin'))
    await writeFile(join(directory, 'audio.bin'), bytes.subarray(0, bytes.length - 1))
    await expect(async () => {
      for await (const packet of mediaRecords(join(directory, 'audio.bin'))) void packet
    }).rejects.toThrow('Truncated')
  })
  it('does not persist paused frames and keeps a static last frame until stop', async () => {
    const directory = await temp()
    const store = await SegmentStore.create(directory, () => undefined)
    const failed = vi.fn()
    const capture = new RecordingCapture(store, view(), configuration, vi.fn(), failed)
    capture.arm()
    capture.video({ type: 'data', keyframe: true, pts: 1_000_000n, data: Uint8Array.of(1) })
    await new Promise((resolve) => setTimeout(resolve, 30))
    capture.pause()
    const duration = capture.durationMs()
    capture.video({ type: 'configuration', data: configuration })
    capture.video({ type: 'data', keyframe: true, pts: 5_000_000n, data: Uint8Array.of(2) })
    expect(capture.durationMs()).toBe(duration)
    capture.arm()
    capture.video({ type: 'data', keyframe: false, pts: 6_000_000n, data: Uint8Array.of(3) })
    capture.video({ type: 'data', keyframe: true, pts: 7_000_000n, data: Uint8Array.of(4) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await capture.seal()
    expect(failed).not.toHaveBeenCalled()
    expect(capture.segments).toHaveLength(2)
    expect(capture.durationMs()).toBeGreaterThan(45)
    expect(capture.durationMs()).toBeLessThan(500)
    const frames: import('@shared/recording').ProcessorFrame[] = []
    for await (const frame of videoFrames(directory, {
      version: 1,
      task: view(),
      sealed: true,
      segments: capture.segments
    }))
      frames.push(frame)
    expect(frames.map((frame) => frame.boundary)).toEqual([true, true])
    expect(frames[1].timestamp).toBe(Number(BigInt(capture.segments[0].end) - 1_000_000n))
    expect(frames[0].duration).toBeGreaterThan(25_000)
  })
  it('publishes concurrently without overwriting another result or a user file', async () => {
    const directory = await temp()
    const bytes = Buffer.alloc(128)
    bytes.write('ftyp', 4)
    await writeFile(join(directory, 'device.mp4'), 'user file')
    const a = join(directory, 'a.part'),
      b = join(directory, 'b.part')
    await writeFile(a, bytes)
    await writeFile(b, bytes)
    const files = await Promise.all([
      publishRecording(a, directory, 'device'),
      publishRecording(b, directory, 'device')
    ])
    expect(new Set(files).size).toBe(2)
    expect(await readFile(join(directory, 'device.mp4'), 'utf8')).toBe('user file')
    expect(files.every((file) => !file.includes('.part'))).toBe(true)
    expect(recordingBaseName('../a/b:device')).not.toMatch(/[\\/:]/)
    expect(recordingBaseName('../a/b:device')).not.toMatch(/^\./)
  })
})

describe('continuous rotation boundary', () => {
  it('uses the next device PTS instead of socket arrival time and retains AAC crossing that boundary', async () => {
    const directory = await temp()
    const store = await SegmentStore.create(directory, () => undefined)
    const task = view()
    task.audio = 'available'
    const capture = new RecordingCapture(store, task, configuration, vi.fn(), vi.fn())
    capture.arm()
    capture.video({ type: 'data', keyframe: true, pts: 1_000_000n, data: Uint8Array.of(1) })
    capture.audio({ type: 'configuration', data: Uint8Array.of(0x11, 0x90) })
    capture.audio({ type: 'data', keyframe: true, pts: 1_990_000n, data: Uint8Array.of(2) })
    capture.video({ type: 'configuration', data: configuration })
    capture.video({ type: 'data', keyframe: true, pts: 2_000_000n, data: Uint8Array.of(3) })
    capture.video({ type: 'data', keyframe: false, pts: 2_100_000n, data: Uint8Array.of(4) })
    await capture.seal()
    expect(capture.segments[0].end).toBe('2000000')
    expect(capture.segments[1]).toMatchObject({
      start: '2000000',
      offset: '1000000',
      continuous: true
    })
    const { audioFrames } = await import('../source')
    const audio: import('../source').AudioFrame[] = []
    for await (const frame of audioFrames(directory, {
      version: 1,
      task,
      sealed: true,
      segments: capture.segments
    }))
      audio.push(frame)
    expect(audio).toHaveLength(1)
    expect(audio[0].timestamp).toBe(990000)
  })
})
