// @vitest-environment node
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { AdbRunResult } from '../adb'
import { enabledCutoutOverlays, resetDisplayCutout } from '../displayCutout'

const HOLE = 'com.android.internal.display.cutout.emulation.hole'
const OLD_BOOT = '00000000-0000-4000-8000-000000000001'
const NEW_BOOT = '00000000-0000-4000-8000-000000000002'
const input = (): Parameters<typeof resetDisplayCutout>[0] => ({
  adbPath: '/adb',
  serial: 'emulator-5556',
  avdName: 'owned-avd',
  signal: new AbortController().signal
})

const harness = (
  options: {
    identity?: string
    enabled?: boolean
    failDisable?: boolean
    controller?: AbortController
  } = {}
): {
  run: Mock<(_path: string, args: string[]) => Promise<AdbRunResult>>
  now: () => number
  sleep: (ms: number) => Promise<void>
} => {
  let active = options.enabled ?? true
  let rebooted = false
  let clock = 0
  const run = vi.fn(async (_path: string, args: string[]) => {
    const command = args.slice(2).join(' ')
    let stdout = ''
    if (command === 'emu avd name') stdout = `${options.identity ?? 'owned-avd'}\nOK`
    if (command === 'shell am get-current-user') stdout = '10'
    if (command.startsWith('shell cmd overlay list'))
      stdout = `${active ? '[x]' : '[ ]'} ${HOLE}\n[x] unrelated.overlay`
    if (command.startsWith('shell cmd overlay disable')) {
      if (options.failDisable) return { code: 1, stdout: '', stderr: '拒绝操作' }
      active = false
      options.controller?.abort()
    }
    if (command === 'shell cat /proc/sys/kernel/random/boot_id')
      stdout = rebooted ? NEW_BOOT : OLD_BOOT
    if (command === 'reboot') rebooted = true
    if (command === 'shell getprop sys.boot_completed') stdout = '1'
    return { code: 0, stdout, stderr: '' }
  })
  return {
    run,
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    }
  }
}

describe('显式恢复默认挖孔', () => {
  it('只识别启用的内置模拟包，不接受任意包名或命令内容', () => {
    expect(
      enabledCutoutOverlays(
        `[x] ${HOLE}\n[ ] com.android.internal.display.cutout.emulation.tall\n[x] android.cutout.overlay\n[x] ${HOLE};reboot`
      )
    ).toEqual([HOLE])
  })
  it('核验目标、当前用户，关闭目标模拟包并等待新的 boot id', async () => {
    const h = harness()
    await resetDisplayCutout(input(), h)
    expect(h.run).toHaveBeenCalledWith(
      '/adb',
      ['-s', 'emulator-5556', 'shell', 'cmd', 'overlay', 'disable', '--user', '10', HOLE],
      expect.objectContaining({ timeoutMs: 5000 })
    )
    expect(h.run).toHaveBeenCalledWith('/adb', ['-s', 'emulator-5556', 'reboot'], expect.anything())
    expect(
      h.run.mock.calls.filter(([, args]) => args.includes('/proc/sys/kernel/random/boot_id'))
    ).toHaveLength(2)
  })
  it('没有残留时幂等完成，不重启、不改其他 overlay', async () => {
    const h = harness({ enabled: false })
    await resetDisplayCutout(input(), h)
    expect(
      h.run.mock.calls.some(([, args]) => args.includes('disable') || args.includes('reboot'))
    ).toBe(false)
  })
  it('目标身份不同立即拒绝，不修改其他模拟器', async () => {
    const h = harness({ identity: 'foreign-avd' })
    await expect(resetDisplayCutout(input(), h)).rejects.toThrow('身份已变化')
    expect(h.run).toHaveBeenCalledTimes(1)
  })
  it('禁用失败不重启，交由待处理标记下次重试', async () => {
    const h = harness({ failDisable: true })
    await expect(resetDisplayCutout(input(), h)).rejects.toThrow('拒绝操作')
    expect(h.run.mock.calls.some(([, args]) => args.includes('reboot'))).toBe(false)
  })
  it('取消后不继续向串号发送重启或迟到恢复命令', async () => {
    const controller = new AbortController()
    const h = harness({ controller })
    await expect(resetDisplayCutout({ ...input(), signal: controller.signal }, h)).rejects.toThrow()
    expect(h.run.mock.calls.some(([, args]) => args.includes('reboot'))).toBe(false)
  })
  it('旧 boot_completed=1 不能冒充新启动完成；总期限后报错', async () => {
    const h = harness()
    const base = h.run.getMockImplementation()!
    h.run.mockImplementation(async (path, args) =>
      args.includes('/proc/sys/kernel/random/boot_id')
        ? { code: 0, stdout: OLD_BOOT, stderr: '' }
        : base(path, args)
    )
    await expect(resetDisplayCutout(input(), h)).rejects.toThrow('重启超时')
  })
})
