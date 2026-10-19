import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  ProcessorAuth,
  ProcessorFrame,
  ProcessorInit,
  ProcessorPacket
} from '@shared/recording'
import { PROCESS_BATCH_BYTES, PROCESS_BATCH_PACKETS } from './limits'

interface Job {
  auth: ProcessorAuth
  window: BrowserWindow
  width: number
  height: number
  frames: AsyncGenerator<ProcessorFrame>
  push: (packet: ProcessorPacket) => Promise<void>
  resolve: () => void
  reject: (error: Error) => void
  pullSeq: number
  pushSeq: number
  eof: boolean
  buffered?: ProcessorFrame
  sized: boolean
  outputWidth: number
  outputHeight: number
  pendingPull: boolean
  pendingPush: boolean
  resized: (width: number, height: number) => Promise<boolean>
  complete: boolean
  timer: ReturnType<typeof setTimeout>
}
let current: Job | undefined
let registered = false
const fail = (error: unknown): void => {
  current?.reject(error instanceof Error ? error : new Error(String(error)))
}
const recordOf = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid processor payload')
  return raw as Record<string, unknown>
}
const authJob = (
  event: Electron.IpcMainInvokeEvent,
  raw: unknown
): { job: Job; value: Record<string, unknown> } => {
  const value = recordOf(raw)
  const job = current
  if (
    !job ||
    job.window.webContents !== event.sender ||
    event.senderFrame !== event.sender.mainFrame ||
    value.jobId !== job.auth.jobId ||
    value.token !== job.auth.token
  )
    throw new Error('Unauthorized recording processor')
  clearTimeout(job.timer)
  job.timer = setTimeout(() => {
    if (current === job) fail(new Error('Recording processor stalled'))
  }, 60_000)
  return { job, value }
}
export const registerProcessorIpc = (): void => {
  if (registered) return
  registered = true
  ipcMain.handle(IPC_CHANNELS.recordingProcessorReady, (event): ProcessorInit => {
    const job = current
    if (
      !job ||
      job.window.webContents !== event.sender ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Unauthorized recording processor')
    return { ...job.auth, width: job.width, height: job.height }
  })
  ipcMain.handle(IPC_CHANNELS.recordingProcessorSize, async (event, raw) => {
    const { job, value } = authJob(event, raw)
    const width = value.width as number,
      height = value.height as number
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 2 ||
      height < 2 ||
      width > job.width ||
      height > job.height ||
      width % 2 ||
      height % 2 ||
      Math.abs(width / job.width - height / job.height) > 0.01
    )
      throw new Error('Invalid recording output size')
    // 原生尺寸提示可等待用户；不把等待响应算作处理页失联。
    clearTimeout(job.timer)
    try {
      const approved =
        width === job.width && height === job.height ? true : await job.resized(width, height)
      job.sized = approved
      if (approved) {
        job.outputWidth = width
        job.outputHeight = height
      }
      return approved
    } finally {
      if (current === job)
        job.timer = setTimeout(() => {
          if (current === job) fail(new Error('Recording processor stalled'))
        }, 60_000)
    }
  })
  ipcMain.handle(IPC_CHANNELS.recordingProcessorPull, async (event, raw) => {
    const { job, value } = authJob(event, raw)
    if (job.pendingPull || !job.sized || value.seq !== job.pullSeq++) {
      const error = new Error('Invalid processor pull sequence')
      fail(error)
      throw error
    }
    job.pendingPull = true
    try {
      const batch: ProcessorFrame[] = []
      let bytes = 0
      for (let i = 0; i < PROCESS_BATCH_PACKETS && bytes < PROCESS_BATCH_BYTES; i++) {
        const next = job.buffered ? { done: false, value: job.buffered } : await job.frames.next()
        job.buffered = undefined
        if (next.done) {
          job.eof = true
          break
        }
        if (next.value.data.byteLength > PROCESS_BATCH_BYTES)
          throw new Error('Video packet exceeds processor budget')
        if (bytes + next.value.data.byteLength > PROCESS_BATCH_BYTES) {
          job.buffered = next.value
          break
        }
        batch.push(next.value)
        bytes += next.value.data.byteLength
      }
      return batch
    } catch (error) {
      fail(error)
      throw error
    } finally {
      job.pendingPull = false
    }
  })
  ipcMain.handle(IPC_CHANNELS.recordingProcessorPush, async (event, raw) => {
    const { job, value } = authJob(event, raw)
    const packet = value.packet as ProcessorPacket | undefined
    if (
      !job.sized ||
      job.pendingPush ||
      value.seq !== job.pushSeq++ ||
      !packet ||
      !(packet.data instanceof Uint8Array) ||
      packet.data.byteLength > PROCESS_BATCH_BYTES ||
      !['key', 'delta'].includes(packet.type) ||
      !Number.isSafeInteger(packet.timestamp) ||
      packet.timestamp < 0 ||
      !Number.isFinite(packet.duration) ||
      packet.duration <= 0 ||
      packet.duration > 86_400_000_000 ||
      (packet.config &&
        (packet.config.codedWidth !== job.outputWidth ||
          packet.config.codedHeight !== job.outputHeight ||
          typeof packet.config.codec !== 'string' ||
          packet.config.codec.length > 100 ||
          (packet.config.description &&
            (!(packet.config.description instanceof Uint8Array) ||
              packet.config.description.byteLength > 65536))))
    ) {
      const error = new Error('Invalid encoded recording packet')
      fail(error)
      throw error
    }
    job.pendingPush = true
    try {
      await job.push(packet)
    } catch (error) {
      fail(error)
      throw error
    } finally {
      job.pendingPush = false
    }
  })
  ipcMain.handle(IPC_CHANNELS.recordingProcessorComplete, (event, raw) => {
    const { job } = authJob(event, raw)
    if (job.pendingPull || job.pendingPush || !job.eof) {
      const error = new Error('Processor still writing')
      fail(error)
      throw error
    }
    job.complete = true
    job.resolve()
  })
  ipcMain.handle(IPC_CHANNELS.recordingProcessorFailed, (event, raw) => {
    const { value } = authJob(event, raw)
    fail(new Error(String(value.error).slice(0, 4096)))
  })
}
export const processVideo = async (
  width: number,
  height: number,
  frames: AsyncGenerator<ProcessorFrame>,
  push: Job['push'],
  resized: Job['resized']
): Promise<void> => {
  if (current) throw new Error('Recording processor busy')
  registerProcessorIpc()
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  let finish!: () => void
  let reject!: (error: Error) => void
  const done = new Promise<void>((resolve, failed) => {
    finish = resolve
    reject = failed
  })
  const job: Job = {
    auth: { jobId: randomUUID(), token: randomUUID() },
    window,
    width,
    height,
    frames,
    push,
    resized,
    resolve: finish,
    reject,
    pullSeq: 0,
    pushSeq: 0,
    eof: false,
    sized: false,
    outputWidth: width,
    outputHeight: height,
    pendingPull: false,
    pendingPush: false,
    complete: false,
    timer: setTimeout(() => reject(new Error('Recording processor load timed out')), 30_000)
  }
  current = job
  window.webContents.once('render-process-gone', () =>
    reject(new Error('Recording processor crashed'))
  )
  window.once('closed', () => {
    if (!job.complete) reject(new Error('Recording processor closed'))
  })
  const loading =
    is.dev && process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/recording-processor.html`)
      : window.loadFile(join(__dirname, '../renderer/recording-processor.html'))
  void loading.catch(reject)
  try {
    await done
  } finally {
    clearTimeout(job.timer)
    current = undefined
    if (!window.isDestroyed()) window.destroy()
    await frames.return(undefined)
  }
}
export const cancelProcessor = (): void => fail(new Error('Recording generation cancelled'))
