import { runAdb } from './adb'
import { awaitWithAbort } from './abort'

const CUTOUT_PACKAGE = /^com\.android\.internal\.display\.cutout\.emulation\.[a-z0-9_]+$/
export const enabledCutoutOverlays = (raw: string): string[] =>
  raw.split('\n').flatMap((line) => {
    const match = line.trim().match(/^\[x\]\s+(\S+)$/)
    return match && CUTOUT_PACKAGE.test(match[1]) ? [match[1]] : []
  })

/** 仅执行用户明确请求的恢复；验证 AVD 身份、当前用户并等待真正的新启动。 */
export const resetDisplayCutout = async (
  input: { adbPath: string; serial: string; avdName: string; signal: AbortSignal },
  deps: {
    run?: typeof runAdb
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {}
): Promise<void> => {
  const { adbPath, serial, avdName, signal } = input
  const run = deps.run ?? runAdb
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const command = async (args: string[]): Promise<string> => {
    const result = await awaitWithAbort(
      () => run(adbPath, ['-s', serial, ...args], { timeoutMs: 5000, signal }),
      signal
    )
    if (result.code !== 0)
      throw new Error(`恢复安卓默认挖孔失败：${result.stderr || 'ADB 命令失败'}`)
    return result.stdout.trim()
  }
  const identity = await command(['emu', 'avd', 'name'])
  if (identity.split(/\r?\n/)[0] !== avdName) throw new Error('模拟器身份已变化，未修改挖孔设置')
  const user = await command(['shell', 'am', 'get-current-user'])
  if (!/^\d+$/.test(user)) throw new Error('无法确认安卓当前用户，未修改挖孔设置')
  const list = (): Promise<string> => command(['shell', 'cmd', 'overlay', 'list', '--user', user])
  const overlays = enabledCutoutOverlays(await list())
  if (overlays.length === 0) return
  const bootId = await command(['shell', 'cat', '/proc/sys/kernel/random/boot_id'])
  if (!/^[a-f0-9-]{36}$/.test(bootId)) throw new Error('无法确认安卓启动代次，未修改挖孔设置')
  for (const overlay of overlays) {
    if ((await command(['shell', 'am', 'get-current-user'])) !== user)
      throw new Error('安卓用户已切换，停止恢复挖孔设置')
    await command(['shell', 'cmd', 'overlay', 'disable', '--user', user, overlay])
  }
  if (enabledCutoutOverlays(await list()).length > 0)
    throw new Error('挖孔设置未恢复，保留请求以便下次重试')
  // API 32 会保留旧 inset 缓存；等待新 boot_id，不能将旧的 boot_completed=1 当成功。
  await command(['reboot'])
  const deadline = now() + 240_000
  while (now() < deadline) {
    if (signal.aborted) throw new Error('挖孔恢复已取消')
    try {
      const currentBoot = await command(['shell', 'cat', '/proc/sys/kernel/random/boot_id'])
      if (
        currentBoot !== bootId &&
        /^[a-f0-9-]{36}$/.test(currentBoot) &&
        (await command(['shell', 'getprop', 'sys.boot_completed'])) === '1'
      ) {
        if ((await command(['shell', 'am', 'get-current-user'])) !== user)
          throw new Error('安卓用户已变化')
        if (enabledCutoutOverlays(await list()).length > 0) throw new Error('重启后挖孔设置未恢复')
        return
      }
    } catch (error) {
      if (signal.aborted) throw error
      // adbd 在重启过程中暂不可用；命令有独立期限，总等待有总期限。
    }
    await awaitWithAbort(() => sleep(1000), signal)
  }
  throw new Error('恢复默认挖孔后安卓重启超时，请重试启动')
}
