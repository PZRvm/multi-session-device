import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_PACKET_BYTES, MAX_SPOOL_BYTES } from './limits'
import type { RecordingSegment } from './timeline'
import type { RecordingTask } from '@shared/recording'

export interface Manifest {
  version: 1
  task: RecordingTask
  segments: RecordingSegment[]
  sealed: boolean
}
export interface MediaRecord {
  config: boolean
  keyframe: boolean
  segment: number
  pts: bigint
  rawPts: bigint
  received: bigint
  data: Uint8Array
}
const HEADER = 40
export const hostUs = (): bigint => process.hrtime.bigint() / 1000n
export class SegmentStore {
  private video: WriteStream
  private audio: WriteStream
  private closed = false
  private failure?: Error
  bytes = 0
  private constructor(
    readonly directory: string,
    failed: (error: Error) => void
  ) {
    this.video = createWriteStream(join(directory, 'video.bin'), { flags: 'wx' })
    this.audio = createWriteStream(join(directory, 'audio.bin'), { flags: 'wx' })
    for (const stream of [this.video, this.audio])
      stream.on('error', (error) => {
        this.failure = error
        failed(error)
      })
  }
  static async create(directory: string, failed: (error: Error) => void): Promise<SegmentStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return new SegmentStore(directory, failed)
  }
  append(track: 'video' | 'audio', record: MediaRecord): void {
    if (this.closed) throw new Error('Recording spool closed')
    if (this.failure) throw this.failure
    if (
      record.data.byteLength > MAX_PACKET_BYTES ||
      this.video.writableLength + this.audio.writableLength + record.data.byteLength + HEADER >
        MAX_SPOOL_BYTES
    )
      throw new Error('Recording disk queue exceeded 16 MiB')
    const header = Buffer.alloc(HEADER)
    header[0] = record.config ? 0 : 1
    header[1] = record.keyframe ? 1 : 0
    header.writeUInt32BE(record.segment, 4)
    header.writeBigInt64BE(record.pts, 8)
    header.writeBigInt64BE(record.rawPts, 16)
    header.writeBigInt64BE(record.received, 24)
    header.writeUInt32BE(record.data.byteLength, 32)
    const stream = track === 'video' ? this.video : this.audio
    stream.write(header)
    stream.write(record.data)
    this.bytes += HEADER + record.data.byteLength
  }
  async flush(): Promise<void> {
    if (this.failure) throw this.failure
    await Promise.all(
      [this.video, this.audio].map(
        (stream) =>
          new Promise<void>((resolve, reject) => {
            stream.write(Buffer.alloc(0), (error) => (error ? reject(error) : resolve()))
          })
      )
    )
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all(
      [this.video, this.audio].map(
        (stream) =>
          new Promise<void>((resolve, reject) => {
            if (stream.destroyed) {
              this.failure ? reject(this.failure) : resolve()
              return
            }
            stream.once('error', reject)
            stream.end(() => {
              stream.removeListener('error', reject)
              resolve()
            })
          })
      )
    )
    if (this.failure) throw this.failure
  }
}
export const saveManifest = async (directory: string, manifest: Manifest): Promise<void> => {
  const temp = join(directory, 'manifest.part')
  await writeFile(temp, JSON.stringify(manifest), { mode: 0o600 })
  await rename(temp, join(directory, 'manifest.json'))
}
export const readManifest = async (directory: string): Promise<Manifest> =>
  JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Manifest
/** 每次最多持有一帧；损坏尾记录明确失败，不能被当作完整成片。 */
export async function* mediaRecords(path: string): AsyncGenerator<MediaRecord> {
  const file = await open(path, 'r')
  let offset = 0
  const exact = async (buffer: Buffer): Promise<number> => {
    let done = 0
    while (done < buffer.length) {
      const { bytesRead } = await file.read(buffer, done, buffer.length - done, offset + done)
      if (!bytesRead) break
      done += bytesRead
    }
    offset += done
    return done
  }
  try {
    for (;;) {
      const header = Buffer.alloc(HEADER)
      const count = await exact(header)
      if (count === 0) break
      if (count !== HEADER || header[0] > 1 || header[1] > 1)
        throw new Error('Corrupt recording packet header')
      const size = header.readUInt32BE(32)
      if (!size || size > MAX_PACKET_BYTES) throw new Error('Invalid recording packet size')
      const data = Buffer.alloc(size)
      if ((await exact(data)) !== size) throw new Error('Truncated recording packet')
      yield {
        config: header[0] === 0,
        keyframe: header[1] === 1,
        segment: header.readUInt32BE(4),
        pts: header.readBigInt64BE(8),
        rawPts: header.readBigInt64BE(16),
        received: header.readBigInt64BE(24),
        data
      }
    }
  } finally {
    await file.close()
  }
}
