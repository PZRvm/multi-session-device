import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import type { RecordingTask } from '@shared/recording'
import { SegmentStore, hostUs, type MediaRecord } from './segments'
import {
  AacClock,
  inSegment,
  parseAacConfig,
  segmentDuration,
  type RecordingSegment
} from './timeline'
import { videoConfig } from './source'
import { AUDIO_STALL_MS, KEYFRAME_TIMEOUT_MS } from './limits'
import { recordingMsg as msg } from './copy'

/** 落盘失败与流校验失败分流：磁盘错误说磁盘，时间戳/尺寸异常说数据校验 */
class DiskAppendError extends Error {}

export class RecordingCapture {
  readonly segments: RecordingSegment[] = []
  private configuration: Uint8Array | null
  private current?: RecordingSegment
  private lastPts = 0n
  private lastHost = 0n
  private waiting = false
  private reconfiguring = false
  private stopped = false
  private keyTimer?: ReturnType<typeof setTimeout>
  private audioClock?: AacClock
  private audioConfig?: Uint8Array
  private audioAt = hostUs()
  private audioFirst?: () => void
  private audioFailure?: (error: Error) => void
  readonly audioReady: Promise<void>
  private audioReadySettled = false
  constructor(
    readonly store: SegmentStore,
    readonly view: RecordingTask,
    configuration: Uint8Array | null,
    private readonly changed: () => void,
    private readonly failed: (reason: string) => void
  ) {
    this.configuration = configuration
    this.audioReady = new Promise((resolve, reject) => {
      this.audioFirst = resolve
      this.audioFailure = reject
    })
    void this.audioReady.catch(() => undefined)
  }
  private record(
    data: Uint8Array,
    pts: bigint,
    rawPts: bigint,
    segment: number,
    config = false,
    keyframe = false
  ): MediaRecord {
    return { data, pts, rawPts, segment, config, keyframe, received: hostUs() }
  }
  private append(track: 'video' | 'audio', record: MediaRecord): void {
    try {
      this.store.append(track, record)
    } catch (error) {
      throw new DiskAppendError(error instanceof Error ? error.message : String(error))
    }
  }
  arm(): void {
    if (this.stopped) return
    this.waiting = true
    clearTimeout(this.keyTimer)
    this.keyTimer = setTimeout(() => this.failed(msg('timeout')), KEYFRAME_TIMEOUT_MS)
  }
  private closeSegment(): void {
    if (!this.current) return
    this.current.end = String(this.lastPts + (hostUs() - this.lastHost))
    if (BigInt(this.current.end) <= BigInt(this.current.start))
      this.current.end = String(BigInt(this.current.start) + 1n)
    this.current = undefined
  }
  video(packet: ScrcpyMediaStreamPacket): void {
    if (this.stopped) return
    try {
      if (packet.type === 'configuration') {
        this.configuration = packet.data.slice()
        if (this.current) {
          this.reconfiguring = true
          this.arm()
        }
        return
      }
      if (packet.pts === undefined || !this.configuration) return
      if (this.waiting) {
        if (!packet.keyframe) return
        const continuous = this.reconfiguring && !!this.current
        if (continuous) {
          if (packet.pts <= this.lastPts) throw new Error('Video timestamp discontinuity')
          this.current!.end = String(packet.pts)
          this.current = undefined
        }
        this.reconfiguring = false
        const format = videoConfig(this.configuration)
        const segment: RecordingSegment = {
          index: this.segments.length,
          start: String(packet.pts),
          end: String(packet.pts + 1n),
          offset: String(segmentDuration(this.segments)),
          continuous,
          width: format.width,
          height: format.height
        }
        if (
          format.width <= 0 ||
          format.height <= 0 ||
          format.width > 16384 ||
          format.height > 16384
        )
          throw new Error('Invalid recording frame size')
        this.segments.push(segment)
        this.current = segment
        this.append('video', this.record(this.configuration, -1n, -1n, segment.index, true))
        this.waiting = false
        clearTimeout(this.keyTimer)
        this.view.state = 'recording'
        this.view.width = Math.max(this.view.width, format.width)
        this.view.height = Math.max(this.view.height, format.height)
        this.changed()
      }
      const segment = this.current
      if (!segment) return
      if (packet.pts < BigInt(segment.start) || (this.lastHost && packet.pts <= this.lastPts))
        throw new Error('Video timestamp discontinuity')
      this.lastPts = packet.pts
      this.lastHost = hostUs()
      segment.end = String(packet.pts + 1n)
      this.append(
        'video',
        this.record(packet.data, packet.pts, packet.pts, segment.index, false, !!packet.keyframe)
      )
    } catch (error) {
      this.failed(
        error instanceof DiskAppendError
          ? `${msg('diskFailed')}: ${error.message}`
          : `${msg('invalidStream')}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  audio(packet: ScrcpyMediaStreamPacket): void {
    if (this.stopped) return
    try {
      this.audioAt = hostUs()
      if (packet.type === 'configuration') {
        if (this.audioConfig && !Buffer.from(this.audioConfig).equals(packet.data))
          throw new Error('AAC configuration changed')
        if (!this.audioConfig) {
          this.audioConfig = packet.data.slice()
          this.audioClock = new AacClock(parseAacConfig(packet.data))
          this.append('audio', this.record(packet.data, -1n, -1n, 0, true))
        }
        return
      }
      if (packet.pts === undefined || !this.audioClock)
        throw new Error('AAC packet without configuration')
      const pts = this.audioClock.next(packet.pts)
      if (!this.audioReadySettled) {
        this.audioReadySettled = true
        this.audioFirst?.()
      }
      const duration =
        (BigInt(this.audioClock.format.samples) * 1_000_000n) /
        BigInt(this.audioClock.format.sampleRate)
      const candidates = this.current
        ? [this.current, ...this.segments.slice(-2).reverse()]
        : this.segments.slice(-2).reverse()
      const segment = candidates.find((entry) =>
        entry === this.current ? pts >= BigInt(entry.start) : inSegment(entry, pts, duration)
      )
      if (!segment) return
      this.append('audio', this.record(packet.data, pts, packet.pts, segment.index))
    } catch (error) {
      if (error instanceof DiskAppendError) {
        this.failed(`${msg('diskFailed')}: ${error.message}`)
        return
      }
      this.audioEnded(error instanceof Error ? error : new Error(String(error)))
    }
  }
  audioEnded(error = new Error(msg('audioLost'))): void {
    if (this.stopped) return
    if (!this.audioReadySettled) {
      this.audioReadySettled = true
      this.audioFailure?.(error)
    } else this.failed(`${msg('audioLost')}: ${error.message}`)
  }
  checkAudio(): void {
    if (
      !this.stopped &&
      this.view.audio === 'available' &&
      hostUs() - this.audioAt > BigInt(AUDIO_STALL_MS * 1000)
    )
      this.audioEnded()
  }
  durationMs(): number {
    const duration = segmentDuration(this.segments)
    return Number(duration + (this.current ? hostUs() - this.lastHost : 0n)) / 1000
  }
  pause(): void {
    this.waiting = false
    this.reconfiguring = false
    clearTimeout(this.keyTimer)
    this.closeSegment()
  }
  async seal(): Promise<void> {
    this.pause()
    this.stopped = true
    if (!this.audioReadySettled) {
      this.audioReadySettled = true
      this.audioFailure?.(new Error('Recording stopped'))
    }
    await this.store.close()
  }
}
