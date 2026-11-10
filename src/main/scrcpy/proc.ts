import { adbRecovery } from '../emulator/adbRecovery'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect as tcpConnect, type Socket } from 'node:net'
import { scrubAdbEnv } from '../emulator/adb'

// ---- 进程工具（真实实现；单测整体替换 manager deps 或 transport deps）----

export const runAdb = (
  path: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const finish = adbRecovery.command()
    let child: ChildProcess
    try {
      child = spawn(path, args, { env: scrubAdbEnv(process.env), windowsHide: true })
    } catch (error) {
      finish()
      reject(error)
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error) => {
      finish()
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      finish()
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8').slice(-2000)
      })
    })
  })

export const spawnProc = (path: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess => {
  adbRecovery.assertOpen()
  return spawn(path, args, { env, windowsHide: true })
}

export const connectTcp = (port: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })

/** 无线熄屏治理（2026-11-10 调查）：KEYCODE_WAKEUP(224) 点亮屏幕，不解锁。表面编码器
 *  熄屏停帧——不唤醒则画面冻结、恢复链 resetVideo 也产不出新帧。尽力而为：吞错。
 *  run 走接缝（测试注入 fake；生产传 proc.runAdb 或 ctx.deps.runAdb）。 */
export const wakeDeviceScreen = async (
  run: typeof runAdb,
  adbPath: string,
  serial: string
): Promise<void> => {
  try {
    await run(adbPath, ['-s', serial, 'shell', 'input', 'keyevent', '224'], 10_000)
  } catch {
    // 设备刚离线/adb 忙时静默放弃
  }
}
