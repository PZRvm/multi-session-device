import { access, constants, link, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileTimestamp, sanitizeFileSegment } from '../filename'
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
/** stderr 有界尾部——与 emulator/adb runAdb 同款（崩溃原因看尾部足够，不攒全量） */
const STDERR_TAIL_BYTES = 4096
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function runAdbBinary(
  adbPath: string,
  args: string[],
  { timeoutMs = SCREENCAP_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<AdbBinaryResult> {
  return new Promise<AdbBinaryResult>((resolve, reject) => {
    const child = spawn(adbPath, args, { env: scrubAdbEnv(process.env), windowsHide: true })
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
        resolve({ code: -1, stdout: Buffer.alloc(0), stderr: msg('screenshotOversized') })
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
      const rawStderr = Buffer.concat(err)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out),
        stderr:
          rawStderr.length > STDERR_TAIL_BYTES
            ? rawStderr.subarray(-STDERR_TAIL_BYTES).toString('utf8')
            : rawStderr.toString('utf8')
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
  /** 截屏尾段 running 复核（同步读，不触发 ensureLoaded）：与 cache.set 之间零异步间隙，
   * 停止钩子无法插入——async 复核留一个微任务窗口，清掉的缓存会被迟到回填 */
  isRunningDevice: (id: string) => boolean
  /** 下载目录（默认系统下载目录；测试注入临时目录） */
  downloadsDir?: () => string
  run?: typeof runAdbBinary
}

const isDeviceIdPayload = (value: unknown): value is { id: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'

/** 设备名 → 安全文件名段：实现收敛在 src/main/filename.ts（与录屏发布共用） */
export { sanitizeFileSegment } from '../filename'

/** 截图时刻 → 本地时区 YYYYMMDD-HHmmss */
export const formatShotStamp = (capturedAt: number): string => fileTimestamp(new Date(capturedAt))

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
/** save 互斥：同设备同时只允许一次保存（双 invoke 与文件名 TOCTOU 的 main 侧防线） */
const saves = new Set<string>()

export const clearScreenshotCache = (deviceId: string): void => {
  cache.delete(deviceId)
}

export function registerScreenshotIpc(deps: ScreenshotDeps): void {
  const run = deps.run ?? runAdbBinary
  const downloadsDir = deps.downloadsDir ?? (() => app.getPath('downloads'))
  // 临时名进程内序号：跨设备并发保存不共享 .part 路径
  let tempSeq = 0
  const requireMainSender = (channel: string, event: Electron.IpcMainInvokeEvent): void => {
    if (!deps.isMainSender(event.sender))
      throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
  }

  ipcMain.handle(
    IPC_CHANNELS.screenshotCapture,
    async (event, raw: unknown): Promise<ScreenshotCaptureResult> => {
      requireMainSender(IPC_CHANNELS.screenshotCapture, event)
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
        // 签名合法但体损坏时 nativeImage 得到 0×0 空图——按失败处理，不写剪贴板
        if (size.width <= 0 || size.height <= 0) {
          throw new Error(
            msg('screenshotCaptureFailed', { detail: `decoded ${size.width}×${size.height}` })
          )
        }
        // 截屏期间设备可能已停止：同步复核 running，避免停止钩子清缓存后这里又回填
        if (!deps.isRunningDevice(id)) throw new Error(msg('screenshotDeviceNotRunning'))
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
      requireMainSender(IPC_CHANNELS.screenshotSave, event)
      if (!isDeviceIdPayload(raw)) {
        throw new Error(`${IPC_CHANNELS.screenshotSave}${msg('invalidPayload')}`)
      }
      const id = raw.id
      // 同步占位（镜像 capture）：同设备保存串行，双 invoke 第二发直接拒绝
      if (saves.has(id)) throw new Error(msg('screenshotSaveBusy'))
      saves.add(id)
      try {
        const cached = cache.get(id)
        if (!cached) throw new Error(msg('screenshotStale'))
        const dir = downloadsDir()
        const base = shotFileName(cached).replace(/\.png$/, '')
        // 撞名重试上限：常态 1 次成功；跨设备同名同秒连续撞名时换 -2/-3 … 递增
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const fileName = await resolveFileName(dir, base)
          // 唯一临时名隔离并发写（save 互斥按设备 id，跨设备不互斥）；终名用
          // link 原子占位——目标已存在报 EEXIST（rename 是静默覆盖，正是要根除的）
          const tempName = `${fileName}.${process.pid}.${(tempSeq += 1)}.part`
          try {
            await writeFile(join(dir, tempName), cached.buffer)
            await link(join(dir, tempName), join(dir, fileName))
            await rm(join(dir, tempName), { force: true })
            return { fileName }
          } catch (error) {
            await rm(join(dir, tempName), { force: true }).catch(() => undefined)
            const code = (error as NodeJS.ErrnoException | null)?.code
            if (code !== 'EEXIST' || attempt === 10) {
              const detail = error instanceof Error ? error.message : String(error)
              throw new Error(msg('screenshotSaveFailed', { detail }))
            }
          }
        }
        throw new Error(msg('screenshotSaveFailed', { detail: 'exhausted retries' }))
      } finally {
        saves.delete(id)
      }
    }
  )
}
