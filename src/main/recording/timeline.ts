export interface AacFormat {
  codec: string
  sampleRate: number
  channels: number
  samples: number
  description: Uint8Array
}
const RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350
]
/** 只接受已验证的 AAC-LC；未知格式必须进入明确的采音失败路径。 */
export const parseAacConfig = (data: Uint8Array): AacFormat => {
  let cursor = 0
  const read = (bits: number): number => {
    if (cursor + bits > data.byteLength * 8) throw new Error('Truncated AAC configuration')
    let result = 0
    while (bits-- > 0) {
      result = result * 2 + ((data[cursor >> 3] >> (7 - (cursor & 7))) & 1)
      cursor++
    }
    return result
  }
  if (read(5) !== 2) throw new Error('Only AAC-LC is supported')
  const index = read(4)
  const sampleRate = index === 15 ? read(24) : RATES[index]
  const channelConfig = read(4)
  const samples = read(1) ? 960 : 1024
  if (
    !sampleRate ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    channelConfig < 1 ||
    channelConfig > 7 ||
    read(1) !== 0 ||
    read(1) !== 0
  )
    throw new Error('Unsupported AAC configuration')
  return {
    codec: 'mp4a.40.2',
    sampleRate,
    channels: channelConfig === 7 ? 8 : channelConfig,
    samples,
    description: data.slice()
  }
}
export class AacClock {
  private first: bigint | undefined
  private count = 0n
  private lastRaw: bigint | undefined
  constructor(readonly format: AacFormat) {}
  next(raw: bigint): bigint {
    if (this.lastRaw !== undefined && (raw <= this.lastRaw || raw - this.lastRaw > 1_000_000n))
      throw new Error('AAC timestamp discontinuity')
    this.lastRaw = raw
    this.first ??= raw
    const result =
      this.first +
      (this.count * BigInt(this.format.samples) * 1_000_000n) / BigInt(this.format.sampleRate)
    this.count++
    return result
  }
}
export interface RecordingSegment {
  index: number
  start: string
  end: string
  offset: string
  continuous?: boolean
  width: number
  height: number
}
export const segmentDuration = (segments: RecordingSegment[]): bigint =>
  segments.reduce((total, segment) => total + BigInt(segment.end) - BigInt(segment.start), 0n)
export const mapTime = (segment: RecordingSegment, pts: bigint): bigint =>
  BigInt(segment.offset) + pts - BigInt(segment.start)
export const inSegment = (segment: RecordingSegment, pts: bigint, duration = 0n): boolean =>
  pts >= BigInt(segment.start) && pts + duration <= BigInt(segment.end) && pts < BigInt(segment.end)
