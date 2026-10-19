import type { ProcessorAuth, ProcessorInit } from '@shared/recording'

const api = window.api.recordingProcessor
const configFor = (width: number, height: number): VideoEncoderConfig => ({
  codec: 'avc1.640034',
  width,
  height,
  bitrate: 8_000_000,
  framerate: 60,
  latencyMode: 'realtime',
  avc: { format: 'avc' }
})
const probe = async (width: number, height: number): Promise<boolean> => {
  const config = configFor(width, height)
  if (!(await VideoEncoder.isConfigSupported(config)).supported) return false
  let failed = false
  let count = 0
  const encoder = new VideoEncoder({
    output: () => {
      count++
    },
    error: () => {
      failed = true
    }
  })
  try {
    encoder.configure(config)
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    for (let i = 0; i < 3; i++) {
      const frame = new VideoFrame(canvas, { timestamp: i * 33333, duration: 33333 })
      try {
        encoder.encode(frame, { keyFrame: i === 0 })
      } finally {
        frame.close()
      }
    }
    await encoder.flush()
    return !failed && count === 3
  } catch {
    return false
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
}
const run = async (init: ProcessorInit): Promise<void> => {
  const { width: requestedWidth, height: requestedHeight } = init
  let width = 0,
    height = 0
  for (const scale of [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25]) {
    const w = Math.max(2, Math.floor((requestedWidth * scale) / 2) * 2)
    const h = Math.max(2, Math.floor((requestedHeight * scale) / 2) * 2)
    if (await probe(w, h)) {
      width = w
      height = h
      break
    }
  }
  if (!width || !height) throw new Error('No supported H.264 encoding size')
  if (!(await api.size(init, width, height))) throw new Error('Output resizing cancelled')
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  let failure: Error | undefined
  // WebCodecs 解码器错误只走 error 回调（没有 error DOM 事件）——fail() 唤醒 drain，
  // 避免解码失败时队列未清、drain 挂到 main 的 60s 看门狗后失败原因失真
  let wakeDrain: (() => void) | undefined
  const fail = (error: Error): void => {
    failure = error
    wakeDrain?.()
  }
  let pending = Promise.resolve()
  let pushSeq = 0
  let pullSeq = 0
  let lastKey = -1_000_000
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      const config = metadata?.decoderConfig
      const description = config?.description
      const bytes = description
        ? new Uint8Array(
            ArrayBuffer.isView(description)
              ? description.buffer.slice(
                  description.byteOffset,
                  description.byteOffset + description.byteLength
                )
              : description.slice(0)
          )
        : undefined
      pending = pending.then(() =>
        api.push(init, pushSeq++, {
          data,
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? 33333,
          config: config
            ? {
                codec: config.codec,
                codedWidth: config.codedWidth,
                codedHeight: config.codedHeight,
                description: bytes
              }
            : undefined
        })
      )
      void pending.catch(fail)
    },
    error: fail
  })
  encoder.configure(configFor(width, height))
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const scale = Math.min(width / requestedWidth, height / requestedHeight)
        const w = frame.displayWidth * scale,
          h = frame.displayHeight * scale
        context.fillStyle = '#000'
        context.fillRect(0, 0, width, height)
        context.drawImage(frame, (width - w) / 2, (height - h) / 2, w, h)
        const composed = new VideoFrame(canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration ?? 33333
        })
        try {
          const keyFrame = frame.timestamp - lastKey >= 1_000_000
          encoder.encode(composed, { keyFrame })
          if (keyFrame) lastKey = frame.timestamp
        } finally {
          composed.close()
        }
      } catch (error) {
        fail(error as Error)
      } finally {
        frame.close()
      }
    },
    error: fail
  })
  const drain = async (): Promise<void> => {
    while (decoder.decodeQueueSize > 0 && !failure)
      await new Promise<void>((resolve) => {
        const onDequeue = (): void => {
          wakeDrain = undefined
          resolve()
        }
        wakeDrain = () => {
          decoder.removeEventListener('dequeue', onDequeue)
          resolve()
        }
        decoder.addEventListener('dequeue', onDequeue, { once: true })
      })
    if (failure) throw failure
  }
  try {
    for (;;) {
      const batch = await api.pull(init, pullSeq++)
      if (!batch.length) break
      for (const packet of batch) {
        if (packet.boundary) {
          if (decoder.state === 'configured') await decoder.flush()
          decoder.configure({ codec: packet.codec })
        }
        decoder.decode(
          new EncodedVideoChunk({
            type: packet.keyframe ? 'key' : 'delta',
            timestamp: packet.timestamp,
            duration: packet.duration,
            data: packet.data
          })
        )
      }
      await drain()
      await encoder.flush()
      await pending
      if (failure) throw failure
    }
    await decoder.flush()
    await encoder.flush()
    await pending
    if (failure) throw failure
    await api.complete(init)
  } finally {
    if (decoder.state !== 'closed') decoder.close()
    if (encoder.state !== 'closed') encoder.close()
  }
}
let auth: ProcessorAuth | undefined
// dev 整页重载会以 pullSeq=0 重新 ready，main 判「Invalid processor pull sequence」终止
// 当前 job（UI 仍有重试入口）——接受该行为，不做跨重载续跑。
void api
  .ready()
  .then(async (init) => {
    auth = init
    await run(init)
  })
  .catch(async (error: unknown) => {
    if (auth)
      await api
        .failed(auth, error instanceof Error ? error.message : String(error))
        .catch(() => undefined)
  })
