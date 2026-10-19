;(async () => {
  const report = window.poc.report
  const { width, height } = await report({ kind: 'init' })
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  let failure
  let pending = Promise.resolve()
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      pending = pending.then(() =>
        report({
          kind: 'packet',
          data,
          metadata,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? 33_333,
          type: chunk.type
        })
      )
    },
    error(error) {
      failure = error
    }
  })
  encoder.configure({
    codec: 'avc1.640034',
    width,
    height,
    bitrate: 8_000_000,
    framerate: 60,
    avc: { format: 'avc' }
  })
  const decoder = new VideoDecoder({
    output(frame) {
      try {
        context.fillStyle = '#000000'
        context.fillRect(0, 0, width, height)
        context.drawImage(
          frame,
          (width - frame.displayWidth) / 2,
          (height - frame.displayHeight) / 2
        )
        const composed = new VideoFrame(canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration ?? 33_333
        })
        encoder.encode(composed, { keyFrame: frame.timestamp % 1_000_000 < 33_333 })
        composed.close()
      } catch (error) {
        failure = error
      } finally {
        frame.close()
      }
    },
    error(error) {
      failure = error
    }
  })
  let lastConfig
  try {
    for (;;) {
      const batch = await report({ kind: 'pull' })
      if (!batch.length) break
      for (const packet of batch) {
        if (packet.configKey !== lastConfig || packet.keyframe) {
          if (decoder.state === 'configured') await decoder.flush()
          decoder.configure(packet.config)
          lastConfig = packet.configKey
        }
        decoder.decode(
          new EncodedVideoChunk({
            type: packet.keyframe ? 'key' : 'delta',
            timestamp: packet.timestamp,
            duration: packet.duration,
            data: packet.data
          })
        )
        if (decoder.decodeQueueSize > 8) {
          await new Promise((resolve) =>
            decoder.addEventListener('dequeue', resolve, { once: true })
          )
        }
      }
      await encoder.flush()
      await pending
      if (failure) throw failure
    }
    await decoder.flush()
    await encoder.flush()
    await pending
    if (failure) throw failure
    await report({ kind: 'done' })
  } finally {
    if (decoder.state !== 'closed') decoder.close()
    if (encoder.state !== 'closed') encoder.close()
  }
})().catch((error) => window.poc.report({ kind: 'error', error: String(error.stack ?? error) }))
