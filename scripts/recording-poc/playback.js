;(async () => {
  const video = document.createElement('video')
  video.muted = true
  const loaded = new Promise((resolve, reject) => {
    video.onloadeddata = resolve
    video.onerror = () =>
      reject(new Error(`media error ${video.error?.code}: ${video.error?.message}`))
  })
  video.src = await window.poc.report({ kind: 'init' })
  document.body.append(video)
  await loaded
  const result = {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration,
    seeks: []
  }
  for (const time of [1, 18, 32]) {
    const seeked = new Promise((resolve) =>
      video.addEventListener('seeked', resolve, { once: true })
    )
    video.currentTime = time
    await seeked
    result.seeks.push({ requested: time, actual: video.currentTime, readyState: video.readyState })
  }
  await video.play()
  await new Promise((resolve) => setTimeout(resolve, 500))
  video.pause()
  result.playedUntil = video.currentTime
  await window.poc.report(result)
})().catch((error) => window.poc.report({ error: String(error.stack ?? error) }))
