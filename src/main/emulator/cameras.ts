import { spawn } from 'node:child_process'
import { join } from 'node:path'

/**
 * 宿主摄像头枚举（plan 设计 7）：`emulator -avd <dummy> -webcam-list`——
 * 所装 emulator 自己的枚举入口，不假定 webcam0 永远存在。实测（2026-10-05，
 * emulator 36.1.9）：命令 0.2s 返回 exit 0，不实际启动 AVD。
 * 权限归属：真实取流由 emulator/QEMU 进程请求 macOS TCC 授权——本应用
 * 获授权不等于 emulator 获授权（向导内据实说明）。
 */

export interface WebcamEntry {
  /** emulator 资源 id（webcam0/webcam1…，-camera-back/-camera-front 取值） */
  id: string
  /** 宿主设备标识（AVCapture device id，用于展示与占用核对） */
  deviceLabel: string
}

export interface WebcamDeps {
  runner?: (emulatorPath: string, args: string[]) => Promise<string>
}

const defaultRunner = (emulatorPath: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(emulatorPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
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
  const entries: WebcamEntry[] = []
  for (const match of output.matchAll(/Camera '(webcam\d+)' is connected to device '([^']+)'/g)) {
    entries.push({ id: match[1], deviceLabel: match[2] })
  }
  return entries
}

export const listWebcams = async (
  sdkRoot: string,
  deps: WebcamDeps = {}
): Promise<WebcamEntry[]> => {
  const emulatorPath = join(sdkRoot, 'emulator', 'emulator')
  const run = deps.runner ?? defaultRunner
  return parseWebcamList(await run(emulatorPath, ['-avd', '__webcam_probe__', '-webcam-list']))
}
