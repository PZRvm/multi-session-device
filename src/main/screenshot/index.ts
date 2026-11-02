import { access, constants, link, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileTimestamp, sanitizeFileSegment } from '../filename'
import { app, clipboard, ipcMain, nativeImage } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ScreenshotCaptureResult, ScreenshotSaveResult } from '@shared/types'
import type { CaptureEditImagePayload } from '@shared/screenshot-editor'
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
  /** 对账标识：新截图与编辑成品回写都换新 id，旧引用自然过期（编辑器域用） */
  captureId: string
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
  /** 打开/聚焦该设备的截图编辑窗并等待就绪（尺寸入参取自缓存现图；空缓存不携，
   *  空态错误由编辑窗取图时如实呈现）。由 ipc 装配注入窗口模块，域不反向依赖 */
  openEditor: (id: string, options?: { imageWidth: number; imageHeight: number }) => Promise<void>
  /** 编辑窗 sender → 绑定设备 id（未登记编辑窗返回 null）。编辑通道权限单源：
   *  取图/导出的设备归属由 main 登记表解析，不信 renderer 自报 id */
  editorDeviceId: (sender: Electron.WebContents) => string | null
  /** 下载目录（默认系统下载目录；测试注入临时目录） */
  downloadsDir?: () => string
  run?: typeof runAdbBinary
}

const isDeviceIdPayload = (value: unknown): value is { id: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** 编辑系入参 captureId 长度白名单（randomUUID 产物 36 字符，防御性封顶；迁自来源） */
const CAPTURE_ID_MAX = 128
/** 编辑成品 data URL 守卫：只接 PNG，总字符数封顶防任意巨串（迁自来源） */
const EDIT_DATAURL_PREFIX = 'data:image/png;base64,'
const EDIT_DATAURL_MAX = 30_000_000

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
/** save 互斥：同设备同时只允许一次保存（双 invoke 与文件名 TOCTOU 的 main 侧防线）；
 *  编辑复制/下载与原保存共用同一占位集合——同设备冲突立即反馈 busy，不另建队列 */
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
  /** 编辑窗专属通道 sender 白名单：归属由窗口登记表解析，未知来源一律拒绝 */
  const requireEditorDevice = (channel: string, event: Electron.IpcMainInvokeEvent): string => {
    const deviceId = deps.editorDeviceId(event.sender)
    if (deviceId === null) {
      console.warn(`[screenshot] 拒绝非编辑窗来源的编辑通道请求: ${channel}`)
      throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
    }
    return deviceId
  }
  const invalidPayload = (channel: string): Error => new Error(`${channel}${msg('invalidPayload')}`)

  /**
   * 编辑成品入参运行时守卫（迁自来源 capture.ts parseEditApplyPayload）：captureId
   * 长度白名单；dataUrl 须为 PNG data URL（前缀 + 长度上限），base64 解码后经
   * nativeImage 验图非空且尺寸有效——坏数据如实按无效参数报错，不入缓存不产出。
   * 返回解码产物（png 入缓存/落盘用，image 验证过的原生图直接写剪贴板，免二次解码）
   */
  const parseEditApplyPayload = (
    channel: string,
    payload: unknown
  ): { captureId: string; png: Buffer; image: Electron.NativeImage } => {
    if (!isRecord(payload) || typeof payload.captureId !== 'string') throw invalidPayload(channel)
    const captureId = payload.captureId
    if (captureId.length === 0 || captureId.length > CAPTURE_ID_MAX) throw invalidPayload(channel)
    if (typeof payload.dataUrl !== 'string') throw invalidPayload(channel)
    const dataUrl = payload.dataUrl
    if (
      dataUrl.length <= EDIT_DATAURL_PREFIX.length ||
      dataUrl.length > EDIT_DATAURL_MAX ||
      !dataUrl.startsWith(EDIT_DATAURL_PREFIX)
    ) {
      throw invalidPayload(channel)
    }
    const png = Buffer.from(dataUrl.slice(EDIT_DATAURL_PREFIX.length), 'base64')
    const image = nativeImage.createFromBuffer(png)
    const size = image.getSize()
    if (image.isEmpty() || size.width <= 0 || size.height <= 0) throw invalidPayload(channel)
    return { captureId, png, image }
  }

  /** 缓存对账：空缓存或 captureId 不匹配（编辑期间同设备又截屏）一律「截图已过期」 */
  const reconcileShot = (deviceId: string, captureId: string): CachedShot => {
    const cached = cache.get(deviceId)
    if (!cached || cached.captureId !== captureId) throw new Error(msg('screenshotStale'))
    return cached
  }

  /**
   * 落盘链共享段（原 save 与编辑窗 editDownload 同链复用）：唯一临时文件 → link
   * 原子占名 → 清理 part → EEXIST 撞名重试。命名按入参条目的 deviceName/capturedAt
   * 派生——原保存传截图时刻条目、编辑下载传保存时刻条目，两条既有命名规则不改
   */
  const writeShotToDownloads = async (cached: CachedShot): Promise<ScreenshotSaveResult> => {
    const dir = downloadsDir()
    const base = shotFileName(cached).replace(/\.png$/, '')
    // 撞名重试上限：常态 1 次成功；跨设备同名同秒连续撞名时换 -2/-3 … 递增
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const fileName = await resolveFileName(dir, base)
      // 唯一临时名隔离并发写（互斥按设备 id，跨设备不互斥）；终名用 link 原子占位
      // ——目标已存在报 EEXIST（rename 是静默覆盖，正是要根除的）
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
          captureId: randomUUID(),
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
        return await writeShotToDownloads(cached)
      } finally {
        saves.delete(id)
      }
    }
  )

  // ===== 截图编辑器域（plan 2026-11-02-screenshot-editor）=====

  // 主窗调：打开/聚焦该设备编辑窗并等待就绪。空缓存不拦截开窗（默认度量开窗，
  // 空态错误由编辑窗 get-edit-image 如实呈现）——同来源语义，不伪造内容
  ipcMain.handle(
    IPC_CHANNELS.screenshotOpenEditor,
    async (event, raw: unknown): Promise<void> => {
      requireMainSender(IPC_CHANNELS.screenshotOpenEditor, event)
      if (!isDeviceIdPayload(raw)) throw invalidPayload(IPC_CHANNELS.screenshotOpenEditor)
      const id = raw.id
      const cached = cache.get(id)
      await deps.openEditor(
        id,
        cached && cached.width > 0 && cached.height > 0
          ? { imageWidth: cached.width, imageHeight: cached.height }
          : undefined
      )
    }
  )

  // 编辑窗取本设备缓存现图：归属由 sender 解析；dataUrl 由缓存 PNG 现编码，尺寸随
  // 载荷返回（编辑窗显示缩放与导出 pixelRatio 的基准，契约 CaptureEditImagePayload）
  ipcMain.handle(
    IPC_CHANNELS.screenshotGetEditImage,
    async (event): Promise<CaptureEditImagePayload> => {
      const deviceId = requireEditorDevice(IPC_CHANNELS.screenshotGetEditImage, event)
      const cached = cache.get(deviceId)
      if (!cached) throw new Error(msg('screenshotStale'))
      return {
        captureId: cached.captureId,
        dataUrl: `${EDIT_DATAURL_PREFIX}${cached.buffer.toString('base64')}`,
        width: cached.width,
        height: cached.height
      }
    }
  )

  // 编辑成品写系统剪贴板 + 回写本设备缓存（换新 captureId——旧引用自然过期，可
  // 续编）。对账与回写之间无 await（剪贴板写入同步），无并发交错窗口；同设备与
  // 截屏/保存互斥（占位检查到写入零 await，防检查-占位间隙）
  ipcMain.handle(IPC_CHANNELS.screenshotEditCopy, async (event, raw: unknown): Promise<void> => {
    const deviceId = requireEditorDevice(IPC_CHANNELS.screenshotEditCopy, event)
    const { captureId, png, image } = parseEditApplyPayload(IPC_CHANNELS.screenshotEditCopy, raw)
    if (captures.has(deviceId)) throw new Error(msg('screenshotBusy'))
    if (saves.has(deviceId)) throw new Error(msg('screenshotSaveBusy'))
    const slot = reconcileShot(deviceId, captureId)
    clipboard.writeImage(image)
    const size = image.getSize()
    cache.set(deviceId, {
      ...slot,
      captureId: randomUUID(),
      buffer: png,
      width: size.width,
      height: size.height
    })
  })

  // 编辑成品落系统下载目录（复用 writeShotToDownloads 防覆盖链；命名 = 设备名-保存
  // 时刻）+ 回写缓存。下载期间缓存被清（设备停止）或被新截屏顶替时不回写——落盘
  // 已成功的文件如实报告成功，不复活已清的缓存（条目身份比较）
  ipcMain.handle(
    IPC_CHANNELS.screenshotEditDownload,
    async (event, raw: unknown): Promise<ScreenshotSaveResult> => {
      const deviceId = requireEditorDevice(IPC_CHANNELS.screenshotEditDownload, event)
      const { captureId, png, image } = parseEditApplyPayload(
        IPC_CHANNELS.screenshotEditDownload,
        raw
      )
      if (captures.has(deviceId)) throw new Error(msg('screenshotBusy'))
      if (saves.has(deviceId)) throw new Error(msg('screenshotSaveBusy'))
      const slot = reconcileShot(deviceId, captureId)
      saves.add(deviceId)
      try {
        const size = image.getSize()
        const next: CachedShot = {
          ...slot,
          captureId: randomUUID(),
          buffer: png,
          width: size.width,
          height: size.height
        }
        const result = await writeShotToDownloads({ ...next, capturedAt: Date.now() })
        if (cache.get(deviceId) === slot) cache.set(deviceId, next)
        return result
      } finally {
        saves.delete(deviceId)
      }
    }
  )
}
