/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { h264ParseConfiguration } from '@yume-chan/scrcpy'
import { packets } from './packets.mjs'

const root = resolve('.codex/recording-poc')
const serial = process.env.MSD_POC_MUX_SERIAL ?? 'emulator-5580'
const from = Number(process.env.MSD_POC_FROM_SECONDS ?? 0)
const intervals = [
  [from, from + 10],
  [from + 12, from + 25],
  [from + 29, from + 45]
]
const {
  Output,
  Mp4OutputFormat,
  FilePathTarget,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket
} = await import(
  pathToFileURL(join(root, 'runtime/node_modules/mediabunny/dist/modules/src/index.js'))
)
const rawAudio = []
let audioConfig
let firstAudio
for await (const p of packets(join(root, `${serial}-audio.bin`))) {
  if (p.configuration) {
    audioConfig = p.data
    continue
  }
  firstAudio ??= p.pts
  if (process.env.MSD_POC_AUDIO_CLOCK === 'samples')
    p.pts = firstAudio + (BigInt(rawAudio.length) * 1024n * 1000000n) / 48000n
  rawAudio.push(p)
  if (p.pts - firstAudio > BigInt((from + 60) * 1e6)) break
}
let base
let config
let segment = null
let segmentEnd
let offsetUs = 0n
let maxWidth = 0
let maxHeight = 0
const segments = []
const video = []
const closeSegment = () => {
  if (!segment) return
  segment.end = segmentEnd
  video.at(-1).duration = Number(segment.end - video.at(-1).sourcePts)
  offsetUs += segment.end - segment.start
  segment = null
}
let intervalIndex = 0
for await (const p of packets(join(root, `${serial}-video.bin`))) {
  if (p.configuration) {
    config = p.data
    continue
  }
  if (base === undefined && (!p.keyframe || p.pts < firstAudio)) continue
  base ??= p.pts
  const relative = Number(p.pts - base) / 1e6
  while (intervalIndex < intervals.length && relative >= intervals[intervalIndex][1]) {
    closeSegment()
    intervalIndex += 1
  }
  if (intervalIndex === intervals.length) break
  if (relative < intervals[intervalIndex][0]) continue
  if (!segment) {
    if (!p.keyframe) continue
    segment = { start: p.pts, offset: offsetUs, end: null }
    segmentEnd = base + BigInt(intervals[intervalIndex][1] * 1e6)
    segments.push(segment)
  }
  const parsed = h264ParseConfiguration(config)
  maxWidth = Math.max(maxWidth, parsed.croppedWidth)
  maxHeight = Math.max(maxHeight, parsed.croppedHeight)
  const previous = video.at(-1)
  if (previous && previous.segment === segment)
    previous.duration = Number(p.pts - previous.sourcePts)
  video.push({
    data: p.keyframe ? Buffer.concat([config, p.data]) : p.data,
    keyframe: p.keyframe,
    configKey: config.toString('hex'),
    config: {
      codec: `avc1.${[parsed.profileIndex, parsed.constraintSet, parsed.levelIndex].map((x) => x.toString(16).padStart(2, '0')).join('')}`
    },
    timestamp: Number(offsetUs + p.pts - segment.start),
    sourcePts: p.pts,
    segment,
    duration: 33_333
  })
}
closeSegment()
if (segments.length !== 3) throw new Error('insufficient capture for three retained intervals')
const audio = []
for (const segment of segments) {
  for (const p of rawAudio) {
    if (p.pts >= segment.start && p.pts + 21_334n <= segment.end) {
      audio.push({ data: p.data, timestamp: Number(segment.offset + p.pts - segment.start) / 1e6 })
    }
  }
}
const suffix =
  (from ? `-${from}` : '') + (process.env.MSD_POC_AUDIO_CLOCK === 'samples' ? '-samples' : '')
const output = new Output({
  format: new Mp4OutputFormat({ fastStart: false }),
  target: new FilePathTarget(join(root, `${serial}-rotated${suffix}.mp4`))
})
const videoSource = new EncodedVideoPacketSource('avc')
const audioSource = new EncodedAudioPacketSource('aac')
output.addVideoTrack(videoSource)
output.addAudioTrack(audioSource)
await output.start()
let cursor = 0
let audioCursor = 0
let videoCount = 0
const started = performance.now()
const window = new BrowserWindow({
  show: false,
  webPreferences: {
    preload: join(import.meta.dirname, 'preload.cjs'),
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false
  }
})
ipcMain.handle('poc:report', async (event, value) => {
  if (event.sender !== window.webContents) throw new Error('unexpected sender')
  if (value.kind === 'init') return { width: maxWidth, height: maxHeight }
  if (value.kind === 'pull')
    return video
      .slice(cursor, (cursor += 8))
      .map(({ data, keyframe, config, configKey, timestamp, duration }) => ({
        data,
        keyframe,
        config,
        configKey,
        timestamp,
        duration
      }))
  if (value.kind === 'packet') {
    while (audioCursor < audio.length && audio[audioCursor].timestamp <= value.timestamp / 1e6) {
      const a = audio[audioCursor]
      await audioSource.add(
        new EncodedPacket(a.data, 'key', a.timestamp, 1024 / 48000),
        audioCursor === 0
          ? {
              decoderConfig: {
                codec: 'mp4a.40.2',
                sampleRate: 48000,
                numberOfChannels: 2,
                description: audioConfig
              }
            }
          : undefined
      )
      audioCursor += 1
    }
    await videoSource.add(
      new EncodedPacket(value.data, value.type, value.timestamp / 1e6, value.duration / 1e6),
      value.metadata
    )
    videoCount += 1
  }
  if (value.kind === 'done') {
    while (audioCursor < audio.length) {
      const a = audio[audioCursor++]
      await audioSource.add(new EncodedPacket(a.data, 'key', a.timestamp, 1024 / 48000))
    }
    videoSource.close()
    audioSource.close()
    await output.finalize()
    const result = {
      width: maxWidth,
      height: maxHeight,
      videoFrames: videoCount,
      audioFrames: audioCursor,
      durationUs: String(offsetUs),
      elapsedMs: Math.round(performance.now() - started),
      intervals: segments.map((s) => ({
        startUs: String(s.start),
        endUs: String(s.end),
        offsetUs: String(s.offset)
      }))
    }
    await writeFile(join(root, `${serial}-process${suffix}.json`), JSON.stringify(result, null, 2))
    console.log(result)
    app.exit(0)
  }
  if (value.kind === 'error') {
    console.error(value.error)
    app.exit(1)
  }
})
await window.loadFile(join(import.meta.dirname, 'process.html'))
setTimeout(() => {
  console.error('processing deadline')
  app.exit(1)
}, 180_000).unref()
