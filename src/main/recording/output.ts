import { rm } from 'node:fs/promises'
import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  FilePathTarget,
  Mp4OutputFormat,
  Output
} from 'mediabunny'
import type { ProcessorPacket } from '@shared/recording'
import type { Manifest } from './segments'
import { audioFrames, inspectVideo, videoFrames } from './source'
import { processVideo } from './processor'
import { segmentDuration } from './timeline'

export interface GenerateOptions {
  directory: string
  temporary: string
  manifest: Manifest
  signal: AbortSignal
  progress: (value: number) => void
  resized: (width: number, height: number) => Promise<boolean>
}
export const generateMp4 = async (options: GenerateOptions): Promise<void> => {
  const { directory, temporary, manifest, signal, progress } = options
  const width = Math.max(...manifest.segments.map((segment) => segment.width))
  const height = Math.max(...manifest.segments.map((segment) => segment.height))
  const duration = Number(segmentDuration(manifest.segments))
  if (!duration || !width || !height) throw new Error('Recording has no decodable frames')
  const direct = await inspectVideo(directory)
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new FilePathTarget(temporary)
  })
  const video = new EncodedVideoPacketSource('avc')
  const audio =
    manifest.task.audio === 'available' ? new EncodedAudioPacketSource('aac') : undefined
  output.addVideoTrack(video)
  if (audio) output.addAudioTrack(audio)
  const audioIterator = audioFrames(directory, manifest)
  let nextAudio = await audioIterator.next()
  let firstAudio = true
  let firstVideo = true
  let videoCount = 0
  let videoEnd = 0
  const check = (): void => {
    if (signal.aborted) throw new Error('Recording generation cancelled')
  }
  const drainAudio = async (until: number): Promise<void> => {
    while (audio && !nextAudio.done && nextAudio.value.timestamp <= until) {
      check()
      const frame = nextAudio.value
      await audio.add(
        new EncodedPacket(frame.data, 'key', frame.timestamp / 1e6, frame.duration / 1e6),
        firstAudio
          ? {
              decoderConfig: {
                codec: frame.format.codec,
                sampleRate: frame.format.sampleRate,
                numberOfChannels: frame.format.channels,
                description: frame.format.description.slice().buffer
              }
            }
          : undefined
      )
      firstAudio = false
      nextAudio = await audioIterator.next()
    }
  }
  const push = async (packet: ProcessorPacket): Promise<void> => {
    check()
    if (
      packet.timestamp + packet.duration > duration + 100_000 ||
      (firstVideo && (packet.type !== 'key' || !packet.config))
    )
      throw new Error('Invalid generated video timeline')
    await drainAudio(packet.timestamp)
    await video.add(
      new EncodedPacket(packet.data, packet.type, packet.timestamp / 1e6, packet.duration / 1e6),
      packet.config
        ? {
            decoderConfig: {
              ...packet.config,
              description: packet.config.description?.slice().buffer
            }
          }
        : undefined
    )
    if (packet.timestamp < videoEnd - 1) throw new Error('Overlapping encoded video frames')
    videoEnd = packet.timestamp + packet.duration
    firstVideo = false
    videoCount++
    progress(Math.min(0.99, (packet.timestamp + packet.duration) / duration))
  }
  try {
    check()
    await output.start()
    if (direct) {
      for await (const frame of videoFrames(directory, manifest)) {
        await push({
          data: frame.data,
          type: frame.keyframe ? 'key' : 'delta',
          timestamp: frame.timestamp,
          duration: frame.duration,
          config: firstVideo
            ? { codec: frame.codec, codedWidth: width, codedHeight: height }
            : undefined
        })
      }
    } else {
      // 奇数裁切尺寸只补到偶数画布；不隐式缩小设备画面。
      const alignedWidth = Math.ceil(width / 2) * 2
      const alignedHeight = Math.ceil(height / 2) * 2
      if (
        (alignedWidth !== width || alignedHeight !== height) &&
        !(await options.resized(alignedWidth, alignedHeight))
      )
        throw new Error('Output alignment cancelled')
      await processVideo(
        alignedWidth,
        alignedHeight,
        videoFrames(directory, manifest),
        push,
        options.resized
      )
    }
    await drainAudio(Infinity)
    if (Math.abs(duration - videoEnd) > 100_000) throw new Error('Incomplete generated video')
    if (!videoCount || (audio && firstAudio)) throw new Error('Recording track is empty')
    video.close()
    audio?.close()
    check()
    await output.finalize()
  } catch (error) {
    await output.cancel().catch(() => undefined)
    await rm(temporary, { force: true })
    throw error
  } finally {
    await audioIterator.return(undefined)
  }
}
