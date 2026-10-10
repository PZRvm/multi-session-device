import { access, constants, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app, clipboard, ipcMain, nativeImage } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenshotCaptureResult, ScreenshotSaveResult } from '@shared/types'
import { msg } from '../locale'
import { scrubAdbEnv } from '../emulator/adb'

/** exec-out 的 stdout 是 PNG 二进制——runAdb 会 utf8 化破坏字节，这里自持 Buffer 版 */
export interface AdbBinaryResult {
  code: number
  stdout: Buffer
  stderr: string
}

const SCREENCAP_TIMEOUT_MS = 15_000
/** 截图体积护栏：正常 PNG 1–3MB，超 32MB 视为异常流 */
const MAX_PNG_BYTES = 32 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function runAdbBinary(
  adbPath: string,
  args: string[],
  { timeoutMs = SCREENCAP_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<AdbBinaryResult> {
  return new Promise<AdbBinaryResult>((resolve, reject) => {
    const child = spawn(adbPath, args, { env: scrubAdbEnv(process.env) })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    let bytes = 0
    const timer = setTimeout(() => {
      settled = true
      child.kill('SIGKILL')
      resolve({
        code: -1,
        stdout: Buffer.alloc(0),
        stderr: msg('adbCommandTimeout', { args: args.join(' '), ms: timeoutMs })
      })
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > MAX_PNG_BYTES) {
        settled = true
        child.kill('SIGKILL')
        clearTimeout(timer)
        resolve({ code: -1, stdout: Buffer.alloc(0), stderr: 'screenshot oversized' })
        return
      }
      out.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!settled) err.push(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8')
      })
    })
  })
}

interface CachedShot {
  buffer: Buffer
  width: number
  height: number
  capturedAt: number
  deviceName: string
}

type RunningDevice = (id: string) => Promise<{ serial: string; name: string } | null>

export interface ScreenshotDeps {
  adbPath: () => string
  isMainSender: (sender: Electron.WebContents) => boolean
  runningDevice: RunningDevice
  /** 下载目录（默认系统下载目录；测试注入临时目录） */
  downloadsDir?: () => string
  run?: typeof runAdbBinary
}

const isDeviceIdPayload = (value: unknown): value is { id: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'

/** 设备名 → 安全文件名段：保留中文，替换路径非法字符与控制符，截断 60 字符 */
export const sanitizeFileSegment = (name: string): string => {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- 文件名清洗本意就是剔除控制字符
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : 'device'
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 截图时刻 → 本地时区 YYYYMMDD-HHmmss */
export const formatShotStamp = (capturedAt: number): string => {
  const date = new Date(capturedAt)
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

const shotFileName = (cached: CachedShot): string =>
  `${sanitizeFileSegment(cached.deviceName)}-${formatShotStamp(cached.capturedAt)}.png`

/** 重名递增：name.png → name-2.png … name-99.png，用尽后带毫秒兜底 */
const resolveFileName = async (dir: string, base: string): Promise<string> => {
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const candidate = attempt === 1 ? `${base}.png` : `${base}-${attempt}.png`
    try {
      await access(join(dir, candidate), constants.F_OK)
    } catch {
      return candidate
    }
  }
  return `${base}-${Date.now()}.png`
}

/** 每设备最近一张（save 消费）；设备停止时经 clearScreenshotCache 清理 */
const cache = new Map<string, CachedShot>()
/** capture 互斥：同设备同时只允许一次截屏（按钮 busy 之外的 main 侧防线） */
const captures = new Set<string>()

export const clearScreenshotCache = (deviceId: string): void => {
  cache.delete(deviceId)
}

export function registerScreenshotIpc(deps: ScreenshotDeps): void {
  const run = deps.run ?? runAdbBinary
  const downloadsDir = deps.downloadsDir ?? (() => app.getPath('downloads'))
  const requireMainSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (!deps.isMainSender(event.sender))
      throw new Error(`${IPC_CHANNELS.screenshotCapture}: ${msg('unregisteredWindowSuffix')}`)
  }

  ipcMain.handle(
    IPC_CHANNELS.screenshotCapture,
    async (event, raw: unknown): Promise<ScreenshotCaptureResult> => {
      requireMainSender(event)
      if (!isDeviceIdPayload(raw)) {
        throw new Error(`${IPC_CHANNELS.screenshotCapture}${msg('invalidPayload')}`)
      }
      const id = raw.id
      // 同步占位再 await：检查与 add 之间若有 await，两次快速调用会双双通过检查
      if (captures.has(id)) throw new Error(msg('screenshotBusy'))
      captures.add(id)
      try {
        const device = await deps.runningDevice(id)
        if (!device) throw new Error(msg('screenshotDeviceNotRunning'))
        const result = await run(deps.adbPath(), [
          '-s',
          device.serial,
          'exec-out',
          'screencap',
          '-p'
        ])
        const png = result.stdout
        if (
          result.code !== 0 ||
          png.length <= PNG_SIGNATURE.length ||
          !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        ) {
          const detail = result.stderr.trim() || `exit ${result.code}`
          throw new Error(msg('screenshotCaptureFailed', { detail }))
        }
        const image = nativeImage.createFromBuffer(png)
        const size = image.getSize()
        // 图像进系统剪贴板是受控动作：只写本设备刚截的图（镜像 copy-serial 守卫策略）
        clipboard.writeImage(image)
        const entry: CachedShot = {
          buffer: png,
          width: size.width,
          height: size.height,
          capturedAt: Date.now(),
          deviceName: device.name
        }
        cache.set(id, entry)
        return { pngBase64: png.toString('base64'), width: size.width, height: size.height }
      } finally {
        captures.delete(id)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.screenshotSave,
    async (event, raw: unknown): Promise<ScreenshotSaveResult> => {
      requireMainSender(event)
      if (!isDeviceIdPayload(raw)) {
        throw new Error(`${IPC_CHANNELS.screenshotSave}${msg('invalidPayload')}`)
      }
      const cached = cache.get(raw.id)
      if (!cached) throw new Error(msg('screenshotStale'))
      const dir = downloadsDir()
      const fileName = await resolveFileName(dir, shotFileName(cached).replace(/\.png$/, ''))
      try {
        await writeFile(join(dir, fileName), cached.buffer)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(msg('screenshotSaveFailed', { detail }))
      }
      return { fileName }
    }
  )
}
