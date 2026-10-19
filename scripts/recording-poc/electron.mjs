/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生 JS 探针不含 TypeScript 返回类型语法 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// 独立能力探针，不注册产品 IPC、不访问用户设备、不自动安装依赖。
const root = resolve(process.env.MSD_RECORDING_POC_ROOT ?? '.codex/recording-poc')
const runtime = resolve(process.env.MSD_RECORDING_POC_RUNTIME ?? join(root, 'runtime'))
const { Output, Mp4OutputFormat, FilePathTarget, EncodedVideoPacketSource, EncodedPacket } =
  await import(
    pathToFileURL(
      process.env.MSD_RECORDING_POC_MODULE ??
        join(runtime, 'node_modules/mediabunny/dist/modules/src/index.js')
    )
  )
await mkdir(root, { recursive: true })
app.setPath('userData', join(root, 'electron-profile'))
const results = { electron: process.versions.electron, chrome: process.versions.chrome, cases: [] }
let output = null
let source = null
let window
let finished = false
const finish = async (error) => {
  if (finished) return
  finished = true
  if (error) results.error = String(error?.stack ?? error)
  await writeFile(join(root, 'capabilities.json'), JSON.stringify(results, null, 2))
  process.stdout.write(JSON.stringify(results, null, 2) + '\n')
  app.exit(error ? 1 : 0)
}
process.on('unhandledRejection', (error) => void finish(error))
await app.whenReady()
window = new BrowserWindow({
  show: false,
  webPreferences: {
    preload: join(import.meta.dirname, 'preload.cjs'),
    sandbox: true,
    contextIsolation: true,
    backgroundThrottling: false
  }
})
ipcMain.handle('poc:report', async (event, value) => {
  if (event.sender !== window.webContents) throw new Error('unexpected sender')
  if (value.kind === 'begin') {
    source = new EncodedVideoPacketSource('avc')
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new FilePathTarget(join(root, 'synthetic.mp4'))
    })
    output.addVideoTrack(source)
    await output.start()
  } else if (value.kind === 'packet') {
    const { data, type, timestamp, duration, metadata } = value
    await source.add(new EncodedPacket(data, type, timestamp / 1e6, duration / 1e6), metadata)
  } else if (value.kind === 'finalize') {
    source.close()
    await output.finalize()
  } else if (value.kind === 'case') {
    results.cases.push(value.result)
  } else if (value.kind === 'done') {
    await finish()
  } else if (value.kind === 'error') {
    await finish(value.error)
  } else throw new Error('unexpected message')
})
window.webContents.on('render-process-gone', (_event, details) => void finish(details.reason))
await window.loadFile(join(import.meta.dirname, 'page.html'))
setTimeout(() => void finish(new Error('probe deadline exceeded')), 90_000).unref()
