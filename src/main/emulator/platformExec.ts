import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/**
 * 引导链短命令的平台执行器（plan 2026-10-22-windows-sdk-bootstrap 设计 1）：
 * win32 下 `.bat`/`.cmd` 不能直接 spawn（Node 安全修复后直接抛 EINVAL，须 cmd.exe /c
 * 包装，见 nodejs child_process 文档「Spawning .bat and .cmd files on Windows」）；
 * 统一补 `windowsHide: true`——GUI 进程拉起 console 子进程不再闪黑框。
 * 只服务 bootstrap/avdmanager 这类短命令；runner 的长驻模拟器进程（detached/进程组）
 * 平行自理，两处不合并——需求形态不同，合并即无谓抽象。
 */

export interface PlatformExecDeps {
  /** 平台接缝（默认 process.platform）——单测注入 win32 走 Windows 分支 */
  platform?: NodeJS.Platform
  /** spawn 接缝（默认 node:child_process 的 spawn）——单测断言最终命令形态 */
  spawnFn?: typeof spawn
}

/** win32 的 .bat/.cmd → `cmd.exe /c <bin> <args…>`；其余平台与命令原样透传 */
export const resolveCommand = (
  platform: NodeJS.Platform,
  bin: string,
  args: readonly string[]
): { command: string; args: string[] } =>
  platform === 'win32' && /\.(bat|cmd)$/i.test(bin)
    ? { command: 'cmd.exe', args: ['/c', bin, ...args] }
    : { command: bin, args: [...args] }

/** spawn 统一入口：resolveCommand + windowsHide（posix 无副作用） */
export const spawnCommand = (
  deps: PlatformExecDeps,
  bin: string,
  args: readonly string[],
  options: SpawnOptions = {}
): ChildProcess => {
  const resolved = resolveCommand(deps.platform ?? process.platform, bin, args)
  return (deps.spawnFn ?? spawn)(resolved.command, resolved.args, {
    ...options,
    windowsHide: true
  })
}

/** win32 用系统自带 bsdtar（tar.exe，官方支持解 zip），其余平台维持 macOS 自带 tar */
export const tarBinFor = (platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32' ? 'tar.exe' : 'tar'
