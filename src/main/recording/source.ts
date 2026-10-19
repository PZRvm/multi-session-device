import { h264ParseConfiguration } from '@yume-chan/scrcpy'
import { join } from 'node:path'
import type { ProcessorFrame } from '@shared/recording'
import { mediaRecords, type Manifest, type MediaRecord } from './segments'
import { inSegment, mapTime, parseAacConfig, type AacFormat } from './timeline'

export const videoConfig = (data: Uint8Array): { codec: string; width: number; height: number } => {
  const parsed = h264ParseConfiguration(data)
  return {
    codec: `avc1.${[parsed.profileIndex, parsed.constraintSet, parsed.levelIndex].map((value) => value.toString(16).padStart(2, '0')).join('')}`,
    width: parsed.croppedWidth,
    height: parsed.croppedHeight
  }
}
export const inspectVideo = async (directory: string): Promise<boolean> => {
  let config: string | undefined
  let same = true
  for await (const record of mediaRecords(join(directory, 'video.bin'))) {
    if (!record.config) continue
    const key = Buffer.from(record.data).toString('hex')
    config ??= key
    if (key !== config) same = false
  }
  if (!config) throw new Error('Missing video configuration')
  return same
}
export async function* videoFrames(
  directory: string,
  manifest: Manifest
): AsyncGenerator<ProcessorFrame> {
  let config: Uint8Array | undefined
  let codec = ''
  let pending:
    { record: MediaRecord; config: Uint8Array; codec: string; boundary: boolean } | undefined
  let boundary = true
  const frame = (value: NonNullable<typeof pending>, next?: MediaRecord): ProcessorFrame => {
    const segment = manifest.segments[value.record.segment]
    if (!segment) throw new Error('Invalid recording segment')
    const end = next?.segment === value.record.segment ? next.pts : BigInt(segment.end)
    if (end <= value.record.pts) throw new Error('Non-monotonic video timestamps')
    return {
      data: value.record.keyframe
        ? Buffer.concat([value.config, value.record.data])
        : value.record.data,
      keyframe: value.record.keyframe,
      codec: value.codec,
      boundary: value.boundary,
      timestamp: Number(mapTime(segment, value.record.pts)),
      duration: Number(end - value.record.pts)
    }
  }
  for await (const record of mediaRecords(join(directory, 'video.bin'))) {
    if (record.config) {
      config = record.data
      codec = videoConfig(config).codec
      boundary = true
      continue
    }
    const segment = manifest.segments[record.segment]
    if (!segment || !inSegment(segment, record.pts)) continue
    if (!config) throw new Error('Video packet without configuration')
    if (pending) yield frame(pending, record)
    if (boundary && !record.keyframe) throw new Error('Segment must begin with a keyframe')
    pending = { record, config, codec, boundary }
    boundary = false
  }
  if (pending) yield frame(pending)
}
export interface AudioFrame {
  data: Uint8Array
  timestamp: number
  duration: number
  format: AacFormat
}
export async function* audioFrames(
  directory: string,
  manifest: Manifest
): AsyncGenerator<AudioFrame> {
  let format: AacFormat | undefined
  let segmentIndex = 0
  for await (const record of mediaRecords(join(directory, 'audio.bin'))) {
    if (record.config) {
      format = parseAacConfig(record.data)
      continue
    }
    if (!format) throw new Error('Audio packet without configuration')
    while (
      segmentIndex + 1 < manifest.segments.length &&
      BigInt(manifest.segments[segmentIndex + 1].start) <= record.pts
    )
      segmentIndex++
    const segment = manifest.segments[segmentIndex]
    const duration = (BigInt(format.samples) * 1_000_000n) / BigInt(format.sampleRate)
    if (!segment || !inSegment(segment, record.pts)) continue
    let endIndex = segmentIndex
    while (manifest.segments[endIndex + 1]?.continuous) endIndex++
    if (record.pts + duration > BigInt(manifest.segments[endIndex].end)) continue
    yield {
      data: record.data,
      timestamp: Number(mapTime(segment, record.pts)),
      duration: (format.samples * 1_000_000) / format.sampleRate,
      format
    }
  }
}
