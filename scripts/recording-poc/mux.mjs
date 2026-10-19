import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile, readFile } from 'node:fs/promises'
import { h264ParseConfiguration } from '@yume-chan/scrcpy'
import { packets } from './packets.mjs'

const root = resolve(process.env.MSD_RECORDING_POC_ROOT ?? '.codex/recording-poc')
const serial = process.env.MSD_POC_MUX_SERIAL ?? 'emulator-5580'
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
const seconds = Number(process.env.MSD_POC_MUX_SECONDS ?? 10)
const from = Number(process.env.MSD_POC_FROM_SECONDS ?? 0)
const suffix =
  (from ? `-${from}` : ``) + (process.env.MSD_POC_AUDIO_CLOCK === 'samples' ? '-samples' : '')
const video = []
const audio = []
let config
let audioConfig
let firstAudio
for await (const packet of packets(join(root, `${serial}-audio.bin`))) {
  if (packet.configuration) {
    audioConfig = packet.data
    continue
  }
  firstAudio ??= packet.pts
  if (process.env.MSD_POC_AUDIO_CLOCK === 'samples')
    packet.pts = firstAudio + (BigInt(audio.length) * 1024n * 1000000n) / 48000n
  audio.push(packet)
  if (packet.pts - firstAudio > BigInt((from + seconds + 10) * 1e6)) break
}
if (!firstAudio || !audioConfig) throw new Error('no audio')
let base
for await (const packet of packets(join(root, `${serial}-video.bin`))) {
  if (packet.configuration) {
    if (base) break // 此探针只验证单一配置直接封装，旋转另测。
    config = packet.data
    continue
  }
  if (!base && (!packet.keyframe || packet.pts < firstAudio + BigInt(from * 1e6))) continue
  base ??= packet.pts
  if (packet.pts - base > BigInt(seconds * 1e6)) break
  video.push(packet)
}
if (!base || !video.length) throw new Error('no eligible video keyframe')
const parsed = h264ParseConfiguration(config)
const codec = `avc1.${[parsed.profileIndex, parsed.constraintSet, parsed.levelIndex].map((x) => x.toString(16).padStart(2, '0')).join('')}`
const capture =
  process.env.MSD_POC_STATIC_TAIL === '1'
    ? JSON.parse(await readFile(join(root, 'capture.json'), 'utf8'))
    : null
const end = capture
  ? video.at(-1).pts + BigInt(capture.endedAtHostUs) - video.at(-1).receivedUs
  : video.at(-1).pts + 33_333n
const output = new Output({
  format: new Mp4OutputFormat({ fastStart: false }),
  target: new FilePathTarget(join(root, `${serial}-av${suffix}.mp4`))
})
const videoSource = new EncodedVideoPacketSource('avc')
const audioSource = new EncodedAudioPacketSource('aac')
output.addVideoTrack(videoSource)
output.addAudioTrack(audioSource)
await output.start()
const audioTrimmed = audio.filter((p) => p.pts >= base && p.pts < end)
let vi = 0
let ai = 0
while (vi < video.length || ai < audioTrimmed.length) {
  if (vi < video.length && (ai === audioTrimmed.length || video[vi].pts <= audioTrimmed[ai].pts)) {
    const packet = video[vi]
    const next = video[vi + 1]
    const duration = Number((next?.pts ?? end) - packet.pts) / 1e6
    await videoSource.add(
      new EncodedPacket(
        packet.keyframe ? Buffer.concat([config, packet.data]) : packet.data,
        packet.keyframe ? 'key' : 'delta',
        Number(packet.pts - base) / 1e6,
        duration
      ),
      vi === 0
        ? {
            decoderConfig: {
              codec,
              codedWidth: parsed.croppedWidth,
              codedHeight: parsed.croppedHeight
            }
          }
        : undefined
    )
    vi += 1
  } else {
    const packet = audioTrimmed[ai]
    await audioSource.add(
      new EncodedPacket(packet.data, 'key', Number(packet.pts - base) / 1e6, 1024 / 48000),
      ai === 0
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
    ai += 1
  }
}
videoSource.close()
audioSource.close()
await output.finalize()
const result = {
  serial,
  codec,
  width: parsed.croppedWidth,
  height: parsed.croppedHeight,
  videoFrames: vi,
  audioFrames: ai,
  firstAudioPts: String(firstAudio),
  firstVideoPts: String(base),
  durationSeconds: Number(end - base) / 1e6,
  audioConfig: audioConfig.toString('hex')
}
await writeFile(join(root, `${serial}-mux${suffix}.json`), JSON.stringify(result, null, 2))
console.log(result)
