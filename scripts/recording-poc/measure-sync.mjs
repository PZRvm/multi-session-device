/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 测量脚本 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const path = process.argv[2]
if (!path) throw new Error('usage: node measure-sync.mjs <test-fixture.mp4> [result.json]')
const run = (args) =>
  execFileSync('ffmpeg', ['-v', 'error', '-i', path, ...args, 'pipe:1'], {
    maxBuffer: 128 * 1024 * 1024
  })
const probe = JSON.parse(
  execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_frames',
      '-show_entries',
      'frame=pts_time,nb_samples,sample_rate',
      '-of',
      'json',
      path
    ],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }
  )
)
const metadata = JSON.parse(
  execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,sample_rate,start_time,duration',
      '-of',
      'json',
      path
    ],
    { encoding: 'utf8' }
  )
)
const audioStream = metadata.streams.find((stream) => stream.codec_type === 'audio')
const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video')
const rate = Number(audioStream.sample_rate)
const pcm = run(['-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le'])
// 居中 2400 方形、1080 竖屏均有效的区域；测试源在这里用白色闪光标记短音。
const video = run([
  '-an',
  '-vf',
  'crop=100:100:(iw-100)/2:(ih-100)/2,scale=1:1,fps=100',
  '-pix_fmt',
  'gray',
  '-f',
  'rawvideo'
])
// PCM 管道会丢掉包时间；按实际解码帧 PTS 还原事件，保留轨道启动偏移和合法间隙。
const audio = []
let cursor = 0
let previousAudio = false
for (const frame of probe.frames) {
  const count = Number(frame.nb_samples)
  for (let start = 0; start < count; start += Math.round(rate / 100)) {
    let peak = 0
    for (let i = start; i < Math.min(count, start + Math.round(rate / 100)); i++)
      peak = Math.max(peak, Math.abs(pcm.readInt16LE((cursor + i) * 2)))
    const on = peak > 1000
    if (on && !previousAudio) audio.push(Number(frame.pts_time) + start / rate)
    previousAudio = on
  }
  cursor += count
}
if (cursor * 2 !== pcm.length) throw new Error('Decoded audio frame/sample count mismatch')
const edges = (values, threshold) => {
  const result = []
  let previous = false
  for (let i = 0; i < values.length; i++) {
    const on = values[i] > threshold
    if (on && !previous && i > 3) result.push(i / 100)
    previous = on
  }
  return result
}
// 仅测完整可观察窗口；末尾被停止边界裁掉的短音不能与上一个脉冲相配。
const end = Math.min(
  Number(videoStream.start_time ?? 0) + Number(videoStream.duration),
  Number(audioStream.start_time ?? 0) + Number(audioStream.duration)
)
const visual = edges(video, 160).filter((time) => time >= 0.1 && time <= end - 0.1)
const errorsMs = visual.map((t) =>
  Math.round(Math.min(...audio.map((a) => Math.abs(a - t))) * 1000)
)
const result = {
  input: resolve(path),
  visualFlashSeconds: visual,
  audioPulseSeconds: audio,
  errorsMs,
  observableWindow: [0.1, end - 0.1],
  maximumErrorMs: errorsMs.length ? Math.max(...errorsMs) : null,
  passed: visual.length >= 3 && audio.length >= 3 && errorsMs.every((x) => x <= 100)
}
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(result, null, 2))
console.log(result)
process.exitCode = result.passed ? 0 : 1
