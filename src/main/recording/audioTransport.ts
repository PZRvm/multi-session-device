import { Readable } from 'node:stream'
import type { Socket } from 'node:net'
import type { ChildProcess } from 'node:child_process'
import { AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy'
import { ScrcpyInstanceId, type ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { scrcpyServerPath } from '../scrcpy/context'
import { connectTcp, runAdb, spawnProc } from '../scrcpy/proc'
import { SCRCPY_SERVER_VERSION, verifyServerBinary } from '../scrcpy/transport'

export interface AudioTransport {
  stream: ReadableStream<ScrcpyMediaStreamPacket>
  close: () => Promise<void>
}
export interface AudioDeps {
  adbPath: () => string
  toolEnv: () => NodeJS.ProcessEnv
}
export const openAudioTransport = async (
  deps: AudioDeps,
  serial: string,
  signal: AbortSignal
): Promise<AudioTransport> => {
  const scid = ScrcpyInstanceId.random()
  const id = scid.toOptionValue()!
  const remote = `/data/local/tmp/msd_recording_audio_${id}.jar`
  const server = scrcpyServerPath()
  let socket: Socket | undefined
  let child: ChildProcess | undefined
  let port: number | undefined
  let closed: Promise<void> | undefined
  const run = (args: string[], timeout = 10_000): ReturnType<typeof runAdb> =>
    runAdb(deps.adbPath(), ['-s', serial, ...args], timeout)
  const close = (): Promise<void> => {
    if (closed) return closed
    closed = (async () => {
      signal.removeEventListener('abort', onAbort)
      socket?.destroy()
      if (child?.exitCode === null) child.kill('SIGTERM')
      if (port !== undefined)
        await run(['forward', '--remove', `tcp:${port}`], 5000).catch(() => undefined)
      await run(['shell', 'rm', '-f', remote], 5000).catch(() => undefined)
    })()
    return closed
  }
  const onAbort = (): void => {
    socket?.destroy()
    if (child?.exitCode === null) child.kill('SIGTERM')
  }
  signal.addEventListener('abort', onAbort)
  const check = (): void => {
    if (signal.aborted) throw new Error('Audio capture cancelled')
  }
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
  try {
    check()
    await verifyServerBinary(server)
    const pushed = await run(['push', server, remote], 30_000)
    if (pushed.code !== 0) throw new Error(pushed.stderr)
    check()
    child = spawnProc(
      deps.adbPath(),
      [
        '-s',
        serial,
        'shell',
        `CLASSPATH=${remote} app_process / com.genymobile.scrcpy.Server ${SCRCPY_SERVER_VERSION} ${options.serialize().join(' ')}`
      ],
      deps.toolEnv()
    )
    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-4096)
    })
    child.stdout?.resume()
    child.on('error', (error) => {
      stderr = String(error)
      socket?.destroy(error)
    })
    const forward = await run(['forward', 'tcp:0', `localabstract:scrcpy_${id.padStart(8, '0')}`])
    if (forward.code !== 0) throw new Error(forward.stderr)
    port = Number(forward.stdout.trim())
    if (!Number.isInteger(port) || port <= 0 || port > 65535)
      throw new Error('Invalid audio forward')
    const deadline = Date.now() + 15_000
    for (;;) {
      check()
      if (Date.now() > deadline) throw new Error(`Audio connection timed out: ${stderr}`)
      try {
        socket = await connectTcp(port)
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      check()
      const current = socket
      const dummy = await new Promise<number | null>((resolve) => {
        const finish = (value: number | null): void => {
          clearTimeout(timer)
          current.removeListener('readable', read)
          current.removeListener('close', ended)
          current.removeListener('error', ended)
          resolve(value)
        }
        const read = (): void => {
          const byte = current.read(1) as Buffer | null
          if (byte) finish(byte[0])
        }
        const ended = (): void => finish(null)
        const timer = setTimeout(() => {
          finish(null)
          current.destroy()
        }, 1000)
        current.on('readable', read)
        current.once('close', ended)
        current.once('error', ended)
        read()
      })
      if (dummy === null) {
        current.destroy()
        continue
      }
      if (dummy !== 0) throw new Error('Invalid audio handshake')
      let metadataTimer!: ReturnType<typeof setTimeout>
      const metadata = await Promise.race([
        options.parseAudioStreamMetadata(
          Readable.toWeb(current) as unknown as Parameters<
            typeof options.parseAudioStreamMetadata
          >[0]
        ),
        new Promise<never>((_, reject) => {
          metadataTimer = setTimeout(() => {
            current.destroy()
            reject(new Error('Audio metadata timed out'))
          }, 10_000)
          metadataTimer.unref()
        })
      ]).finally(() => clearTimeout(metadataTimer))
      check()
      if (metadata.type !== 'success') throw new Error(`Device audio ${metadata.type}: ${stderr}`)
      return {
        stream: metadata.stream.pipeThrough(
          options.createMediaStreamTransformer()
        ) as unknown as ReadableStream<ScrcpyMediaStreamPacket>,
        close
      }
    }
  } catch (error) {
    await close()
    throw error
  }
}
