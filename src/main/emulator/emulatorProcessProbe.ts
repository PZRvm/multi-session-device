import { spawnCommand } from './platformExec'

/**
 * 残留模拟器进程探测（issue 2026-10-31-orphan-emulator 候选 A 的最小落地：
 * 删源操作预检版——应用重启后上代 headless qemu 不在 RunnerRegistry 里，
 * 迁移/回滚/清保留根/采纳的删源步骤会撞它锁着的镜像文件）。
 * win32：tasklist 输出含 qemu-system（覆盖 -headless 等同名前缀变体）即命中；
 * posix：pgrep -f qemu-system 退出码 0 即命中。探测失败按「无残留」放行——
 * 守卫宁松勿误拦（误拦迁移比撞 EPERM 更糟：后者 journal 可重入自愈）。
 */

export interface ProbeRunResult {
  code: number
  stdout: string
}

const defaultRun = async (bin: string, args: string[]): Promise<ProbeRunResult> => {
  const child = spawnCommand({}, bin, args, { stdio: ['ignore', 'pipe', 'ignore'] })
  return await new Promise<ProbeRunResult>((resolve) => {
    const out: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.on('error', () => resolve({ code: -1, stdout: '' }))
    child.on('close', (code) =>
      resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8') })
    )
  })
}

export const liveEmulatorProcessPresent = async (
  run: (bin: string, args: string[]) => Promise<ProbeRunResult> = defaultRun,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> => {
  try {
    if (platform === 'win32') {
      const result = await run('tasklist.exe', ['/FO', 'CSV', '/NH'])
      return /qemu-system/i.test(result.stdout)
    }
    const result = await run('pgrep', ['-f', 'qemu-system'])
    return result.code === 0
  } catch {
    return false
  }
}
