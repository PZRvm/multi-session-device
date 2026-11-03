/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import {
  ScrcpyInstanceId,
  h264ParseConfiguration,
  ScrcpyControlMessageSerializer
} from '@yume-chan/scrcpy'
import { build } from 'esbuild'

const exec = promisify(execFile)
const root = resolve(process.env.MSD_RECORDING_POC_ROOT ?? '.codex/recording-poc')
const adb = process.env.MSD_POC_ADB ?? 'adb'
const serials = (process.env.MSD_POC_SERIALS ?? 'emulator-5580,emulator-5582').split(',')
const durationMs = Number(process.env.MSD_POC_DURATION_MS ?? 620_000)
const start = performance.now()
await mkdir(root, { recursive: true })
await build({
  entryPoints: ['src/main/scrcpy/transport.ts'],
  outfile: join(root, 'transport.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external'
})
const { establishTransport } = await import(pathToFileURL(join(root, 'transport.mjs')))
const run = async (path, args, timeoutMs = 15_000) => {
  try {
    const { stdout, stderr } = await exec(path, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return {
      code: typeof error.code === 'number' ? error.code : -1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message
    }
  }
}
const tcp = (port) =>
  new Promise((accept, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => accept(socket))
    socket.once('error', reject)
  })
const states = []
const cleanup = []
let stopping = false
let stopWaiter
const stopRequested = new Promise((accept) => {
  stopWaiter = accept
})
const stop = async () => {
  if (stopping) return
  stopping = true
  await Promise.allSettled(cleanup.map((fn) => fn()))
}
process.once('SIGINT', () => {
  stopWaiter()
  void stop()
})
process.once('SIGTERM', () => {
  stopWaiter()
  void stop()
})
const streamOf = (socket) =>
  new ReadableStream({
    start(controller) {
      socket.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)))
      socket.on('close', () => {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })
      socket.on('error', (error) => controller.error(error))
    },
    cancel() {
      socket.destroy()
    }
  })

const audioTransport = async (serial, signal) => {
  const scid = ScrcpyInstanceId.random()
  // scrcpy 启动后会清理自己的 jar，独立音频会话须拥有自己的 push 路径。
  const serverPath = `/data/local/tmp/msd_recording_poc_audio_${scid.toOptionValue()}.jar`
  const pushed = await run(adb, [
    '-s',
    serial,
    'push',
    resolve('resources/scrcpy-server-v3.3.3'),
    serverPath
  ])
  if (pushed.code) throw new Error(pushed.stderr)
  const options = new AdbScrcpyOptionsLatest({
    scid,
    video: false,
    audio: true,
    control: false,
    tunnelForward: true,
    sendDeviceMeta: false,
    audioCodec: 'aac',
    audioSource: 'playback',
    audioDup: true
  })
  const proc = spawn(adb, [
    '-s',
    serial,
    'shell',
    `CLASSPATH=${serverPath} app_process / com.genymobile.scrcpy.Server 3.3.3 ${options.serialize().join(' ')}`
  ])
  let stderr = ''
  proc.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-8192)
  })
  const forward = await run(adb, [
    '-s',
    serial,
    'forward',
    'tcp:0',
    `localabstract:scrcpy_${scid.toOptionValue().padStart(8, '0')}`
  ])
  if (forward.code) throw new Error(forward.stderr)
  const port = Number(forward.stdout.trim())
  let socket
  const close = async () => {
    socket?.destroy()
    if (proc.exitCode === null) proc.kill('SIGTERM')
    await run(adb, ['-s', serial, 'forward', '--remove', `tcp:${port}`])
  }
  cleanup.push(close)
  const deadline = performance.now() + 15_000
  while (performance.now() < deadline && !signal.aborted) {
    socket = await tcp(port)
    const dummy = await new Promise((accept) => {
      const timer = setTimeout(() => {
        socket.destroy()
        accept(null)
      }, 1000)
      socket.once('data', (chunk) => {
        clearTimeout(timer)
        socket.pause()
        accept(chunk)
      })
      socket.once('error', () => {
        clearTimeout(timer)
        accept(null)
      })
      socket.once('close', () => {
        clearTimeout(timer)
        accept(null)
      })
    })
    if (!dummy) continue
    if (dummy[0] !== 0) throw new Error('bad audio dummy byte')
    const stream = streamOf(socket)
    if (dummy.length > 1) socket.unshift(dummy.subarray(1))
    socket.resume()
    const metadata = await options.parseAudioStreamMetadata(stream)
    if (metadata.type !== 'success') throw new Error(`audio ${metadata.type}: ${stderr}`)
    return {
      stream: metadata.stream.pipeThrough(options.createMediaStreamTransformer()),
      close,
      stderr: () => stderr
    }
  }
  throw new Error(`audio handshake deadline: ${stderr}`)
}

try {
  await Promise.all(
    serials.map(async (serial) => {
      const abort = new AbortController()
      cleanup.push(async () => abort.abort())
      const prefix = serial.replace(/[^a-zA-Z0-9-]/g, '_')
      const state = {
        serial,
        video: 0,
        audio: 0,
        configs: [],
        firstVideoPts: null,
        firstAudioPts: null,
        lastVideoPts: null,
        lastAudioPts: null,
        errors: [],
        maxRss: 0
      }
      states.push(state)
      const sink = (kind) => {
        const writer = createWriteStream(join(root, `${prefix}-${kind}.bin`))
        writer.on('error', (error) => {
          state.errors.push(`${kind}: ${error.message}`)
          abort.abort()
        })
        cleanup.push(() => new Promise((accept) => writer.end(accept)))
        return writer
      }
      const videoSink = sink('video')
      const audioSink = sink('audio')
      const transport = await establishTransport({
        serial,
        adbPath: adb,
        serverPath: resolve('resources/scrcpy-server-v3.3.3'),
        run,
        spawn: (path, args, env) => spawn(path, args, { env }),
        connect: tcp,
        toolEnv: () => ({ ...process.env }),
        signal: abort.signal
      })
      cleanup.push(transport.teardown)
      const collect = async (stream, kind, writer) => {
        const reader = stream.getReader()
        cleanup.push(() => reader.cancel().catch(() => undefined))
        try {
          while (!abort.signal.aborted) {
            const { done, value } = await reader.read()
            if (done) break
            const record = Buffer.alloc(32)
            record[0] = value.type === 'configuration' ? 0 : 1
            record[1] = value.keyframe ? 1 : 0
            record.writeBigInt64BE(value.pts ?? -1n, 8)
            record.writeUInt32BE(value.data.length, 16)
            record.writeBigInt64BE(BigInt(Math.round(performance.now() * 1000)), 24)
            writer.write(record)
            writer.write(value.data)
            if (writer.writableLength > 16 * 1024 * 1024)
              throw new Error('spool backlog exceeded 16MiB')
            if (value.type === 'data') {
              state[kind] += 1
              const first = kind === 'video' ? 'firstVideoPts' : 'firstAudioPts'
              const last = kind === 'video' ? 'lastVideoPts' : 'lastAudioPts'
              state[first] ??= String(value.pts)
              state[last] = String(value.pts)
            } else if (kind === 'video') {
              const config = h264ParseConfiguration(value.data)
              state.configs.push({
                atMs: Math.round(performance.now() - start),
                width: config.croppedWidth,
                height: config.croppedHeight
              })
            } else state.audioConfig = Buffer.from(value.data).toString('hex')
          }
        } catch (error) {
          if (!stopping) state.errors.push(`${kind}: ${error.message}`)
        }
      }
      void collect(transport.mediaStream, 'video', videoSink)
      const audio = await audioTransport(serial, abort.signal)
      void collect(audio.stream, 'audio', audioSink)
      if (process.env.MSD_POC_RESET_VIDEO === '1') {
        transport.controlSocket.write(
          new ScrcpyControlMessageSerializer(transport.options).resetVideo()
        )
      }
    })
  )
  const interval = setInterval(() => {
    for (const state of states) state.maxRss = Math.max(state.maxRss, process.memoryUsage().rss)
    void writeFile(
      join(root, 'capture-progress.json'),
      JSON.stringify({ elapsedMs: Math.round(performance.now() - start), states }, null, 2)
    )
    process.stdout.write(
      JSON.stringify({ elapsedMs: Math.round(performance.now() - start), states }) + '\n'
    )
  }, 30_000)
  let timer
  await Promise.race([
    new Promise((accept) => {
      timer = setTimeout(accept, durationMs)
    }),
    stopRequested
  ])
  clearTimeout(timer)
  clearInterval(interval)
} catch (error) {
  process.stderr.write(String(error.stack ?? error) + '\n')
  for (const state of states) state.errors.push(error.message)
  process.exitCode = 1
} finally {
  await stop()
  await writeFile(
    join(root, 'capture.json'),
    JSON.stringify(
      {
        elapsedMs: Math.round(performance.now() - start),
        endedAtHostUs: Math.round(performance.now() * 1000),
        states
      },
      null,
      2
    )
  )
}
