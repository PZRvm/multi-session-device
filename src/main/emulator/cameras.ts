import { spawn } from 'node:child_process'
import { systemPreferences } from 'electron'
import type { CameraSnapshot, HostWebcam } from '@shared/types'
import { msg } from '../locale'
import { sdkPaths } from './sdk'

/** 所装 emulator 的摄像头探针；macOS 权限由宿主应用身份与取流责任链共同决定。 */
export type WebcamEntry = HostWebcam

export interface WebcamDeps {
  runner?: (emulatorPath: string, args: string[]) => Promise<string>
}

/** 枚举探针的有界超时（review P3）：emulator 挂死不拖死能力查询的 invoke */
const WEBCAM_LIST_TIMEOUT_MS = 10_000

const defaultRunner = (emulatorPath: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    // windowsHide：win32 上 GUI 进程拉 console 子进程不闪黑框（posix 无副作用）
    const child = spawn(emulatorPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(msg('cameraListTimeout', { seconds: WEBCAM_LIST_TIMEOUT_MS / 1000 })))
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
            msg('cameraListFailed', {
              code: String(code),
              tail: (Buffer.concat(err).toString('utf8') || text).slice(-300)
            })
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
/** 摄像头系统设置深链（平台单源，plan 2026-10-22-windows-emulator-env 设计 4）：
 *  mac 系统偏好（原串逐字节不变）、Windows 隐私设置、其余平台无入口（null = no-op）。 */
export const cameraSettingsUrlFor = (platform: NodeJS.Platform): string | null =>
  platform === 'darwin'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
    : platform === 'win32'
      ? 'ms-settings:privacy-webcam'
      : null

/** 空列表错误文案：win32 指向系统隐私设置（Windows 对桌面应用只有全局相机开关、
 *  无 Electron 可查的 API，permission 恒 granted——空列表即事实）；其余平台
 *  维持原 permission 三分支，darwin 原文逐字节不变。 */
export const cameraListEmptyMessage = (
  permission: CameraSnapshot['permission'],
  platform: NodeJS.Platform
): string => {
  if (platform === 'win32') return msg('cameraNoneFoundWindows')
  if (permission === 'not-determined') return msg('cameraPermissionRequired')
  if (permission === 'denied' || permission === 'restricted') {
    return msg('cameraPermissionNotGranted')
  }
  return msg('cameraNoneFound')
}

export const readCameraSnapshot = async (sdkRoot: string): Promise<CameraSnapshot> => {
  const permission = cameraPermission()
  try {
    const devices = await listWebcams(sdkRoot)
    const error = devices.length > 0 ? null : cameraListEmptyMessage(permission, process.platform)
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
  // emulatorBin 随平台带 .exe 后缀（sdkPaths 单源）
  const emulatorPath = sdkPaths(sdkRoot).emulatorBin
  const run = deps.runner ?? defaultRunner
  const output = await run(emulatorPath, ['-avd', '__webcam_probe__', '-webcam-list'])
  const entries = parseWebcamList(output)
  if (entries.length === 0 && /Camera '/.test(output))
    throw new Error(msg('cameraFormatUnrecognized'))
  return entries
}
