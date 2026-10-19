/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
;(async () => {
  const report = window.poc.report
  const configFor = (width, height) => ({
    codec: 'avc1.640034',
    width,
    height,
    bitrate: 8_000_000,
    framerate: 30,
    avc: { format: 'avc' }
  })
  const frames = async (config, count, onPacket) => {
    let error
    const pending = []
    const encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        pending.push(
          onPacket({
            kind: 'packet',
            data,
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration ?? 33_333,
            metadata
          })
        )
      },
      error: (value) => {
        error = value
      }
    })
    try {
      encoder.configure(config)
      const canvas = new OffscreenCanvas(config.width, config.height)
      const ctx = canvas.getContext('2d')
      for (let i = 0; i < count; i += 1) {
        ctx.fillStyle = i % 30 < 15 ? '#ffffff' : '#000000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#ff0000'
        ctx.fillRect((i * 7) % canvas.width, 0, 20, canvas.height)
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round((i * 1e6) / 30),
          duration: 33_333
        })
        encoder.encode(frame, { keyFrame: i % 30 === 0 })
        frame.close()
        if (encoder.encodeQueueSize > 8) await encoder.flush()
        if (error) throw error
      }
      await encoder.flush()
      await Promise.all(pending)
      if (error) throw error
    } finally {
      if (encoder.state !== 'closed') encoder.close()
    }
  }
  await report({ kind: 'begin' })
  await frames(configFor(320, 240), 90, report)
  await report({ kind: 'finalize' })
  for (const [width, height] of [
    [1080, 2400],
    [2400, 2400],
    [3840, 3840],
    [4320, 4320]
  ]) {
    const config = configFor(width, height)
    const result = { width, height }
    const begin = performance.now()
    try {
      result.supported = (await VideoEncoder.isConfigSupported(config)).supported
      let bytes = 0
      await frames(config, 3, async (value) => {
        bytes += value.data.length
      })
      result.encoded = true
      result.bytes = bytes
    } catch (error) {
      result.error = String(error)
    }
    result.elapsedMs = Math.round(performance.now() - begin)
    await report({ kind: 'case', result })
  }
  const aac = await AudioEncoder.isConfigSupported({
    codec: 'mp4a.40.2',
    numberOfChannels: 2,
    sampleRate: 48_000,
    bitrate: 128_000
  })
  await report({ kind: 'case', result: { audioEncoderAacSupported: aac.supported } })
  await report({ kind: 'done' })
})().catch((error) => window.poc.report({ kind: 'error', error: String(error?.stack ?? error) }))
