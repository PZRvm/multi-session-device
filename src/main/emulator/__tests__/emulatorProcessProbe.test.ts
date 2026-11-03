// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { liveEmulatorProcessPresent } from '../emulatorProcessProbe'

describe('liveEmulatorProcessPresent（残留模拟器进程探测）', () => {
  it('win32：tasklist 输出含 qemu-system（含 -headless 变体、大小写不敏感）即命中', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: '"qemu-system-x86_64-headless.exe","22040"...'
    }))
    await expect(liveEmulatorProcessPresent(run, 'win32')).resolves.toBe(true)
    const clean = vi.fn(async () => ({ code: 0, stdout: '"adb.exe","23672"' }))
    await expect(liveEmulatorProcessPresent(clean, 'win32')).resolves.toBe(false)
  })

  it('posix：pgrep 退出码 0 即命中；非 0 不命中', async () => {
    const hit = vi.fn(async () => ({ code: 0, stdout: '22040' }))
    await expect(liveEmulatorProcessPresent(hit, 'darwin')).resolves.toBe(true)
    const miss = vi.fn(async () => ({ code: 1, stdout: '' }))
    await expect(liveEmulatorProcessPresent(miss, 'darwin')).resolves.toBe(false)
  })

  it('探测抛错按「无残留」放行（守卫宁松勿误拦）', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ENOENT')
    })
    await expect(liveEmulatorProcessPresent(boom, 'win32')).resolves.toBe(false)
  })
})
