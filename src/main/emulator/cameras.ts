import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { systemPreferences } from 'electron'
import type { CameraSnapshot, HostWebcam } from '@shared/types'

/** 所装 emulator 的摄像头探针；macOS 权限由宿主应用身份与取流责任链共同决定。 */
export type WebcamEntry = HostWebcam

export interface WebcamDeps {
  runner?: (emulatorPath: string, args: string[]) => Promise<string>
}

/** 枚举探针的有界超时（review P3）：emulator 挂死不拖死能力查询的 invoke */
const WEBCAM_LIST_TIMEOUT_MS = 10_000

const defaultRunner = (emulatorPath: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(emulatorPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`摄像头枚举超时（${WEBCAM_LIST_TIMEOUT_MS / 1000} 秒），进程已终止`))
    }, WEBCAM_LIST_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      // 枚举不依赖 AVD 存在：即使提示找不到 AVD，摄像头清单仍有效
      const text = Buffer.concat(out).toString('utf8')
      if (code === 0 || text.includes("Camera '")) resolve(text)
      else {
        reject(
          new Error(
            `摄像头枚举失败（exit ${code}）：${(Buffer.concat(err).toString('utf8') || text).slice(-300)}`
          )
        )
      }
    })
  })

/** 解析 -webcam-list 输出（"Camera 'webcam0' is connected to device '<uuid>' …"） */
export const parseWebcamList = (output: string): WebcamEntry[] => {
  const entries = new Map<string, WebcamEntry>()
  for (const line of output.split('\n')) {
    const modern = line.match(
      /Camera '(.+)' can be specified by label as '(webcam\d+)' or by id as '([^']+)'/
    )
    const legacy = line.match(/Camera '(webcam\d+)' is connected to device '([^']+)'/)
    if (modern) entries.set(modern[2], { id: modern[2], deviceLabel: modern[3], name: modern[1] })
    else if (legacy) entries.set(legacy[1], { id: legacy[1], deviceLabel: legacy[2] })
  }
  return [...entries.values()]
}

export const cameraPermission = (): CameraSnapshot['permission'] => {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences?.getMediaAccessStatus?.('camera') ?? 'unknown'
}
let permissionRequest: Promise<boolean> | null = null
export const requestCameraPermission = async (): Promise<boolean> => {
  if (process.platform !== 'darwin') return true
  if (permissionRequest !== null) return permissionRequest
  permissionRequest = systemPreferences.askForMediaAccess('camera')
  try {
    return await permissionRequest
  } finally {
    permissionRequest = null
  }
}
export const readCameraSnapshot = async (sdkRoot: string): Promise<CameraSnapshot> => {
  const permission = cameraPermission()
  try {
    const devices = await listWebcams(sdkRoot)
    const error =
      devices.length > 0
        ? null
        : permission === 'not-determined'
          ? '需要允许本应用访问摄像头'
          : permission === 'denied' || permission === 'restricted'
            ? '摄像头权限未开放，请在系统设置中允许访问并重启应用'
            : '未枚举到摄像头；请检查连接及本应用的系统权限，刷新后重试'
    return { permission, devices, error }
  } catch (error) {
    return {
      permission,
      devices: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export const listWebcams = async (
  sdkRoot: string,
  deps: WebcamDeps = {}
): Promise<WebcamEntry[]> => {
  const emulatorPath = join(sdkRoot, 'emulator', 'emulator')
  const run = deps.runner ?? defaultRunner
  const output = await run(emulatorPath, ['-avd', '__webcam_probe__', '-webcam-list'])
  const entries = parseWebcamList(output)
  if (entries.length === 0 && /Camera '/.test(output))
    throw new Error('摄像头输出格式无法识别，请检查 emulator 版本')
  return entries
}
