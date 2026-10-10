// @vitest-environment node
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import {
  clearScreenshotCache,
  formatShotStamp,
  registerScreenshotIpc,
  runAdbBinary,
  sanitizeFileSegment,
  type AdbBinaryResult,
  type ScreenshotDeps
} from '../index'

const mocks = vi.hoisted(() => ({
  app: { getPath: vi.fn(() => '/tmp/downloads') },
  clipboard: { writeImage: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: {
    createFromBuffer: vi.fn(() => ({ getSize: () => ({ width: 1080, height: 2340 }) }))
  }
}))

vi.mock('electron', () => ({
  app: mocks.app,
  clipboard: mocks.clipboard,
  ipcMain: mocks.ipcMain,
  nativeImage: mocks.nativeImage
}))

// msg 模板化会拉入 locale store——单测只需要稳定的键名拼串
vi.mock('../../locale', () => ({
  msg: (key: string, params?: Record<string, string | number>): string =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body')
])

interface Harness {
  handlers: Map<string, (event: unknown, raw: unknown) => Promise<unknown>>
  run: ReturnType<typeof vi.fn>
  call: (channel: string, raw: unknown) => Promise<unknown>
}

let downloads = ''

const setup = (options?: { running?: boolean }): Harness => {
  const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
  mocks.ipcMain.handle.mockImplementation(
    (channel: string, handler: (event: unknown, raw: unknown) => Promise<unknown>) => {
      handlers.set(channel, handler)
    }
  )
  const run = vi.fn<NonNullable<ScreenshotDeps['run']>>(async () => ({
    code: 0,
    stdout: PNG,
    stderr: ''
  }))
  registerScreenshotIpc({
    adbPath: () => '/fake/adb',
    isMainSender: (sender) => (sender as { id: number }).id === 1,
    runningDevice: async () =>
      options?.running === false ? null : { serial: 'emulator-5554', name: '测试设备' },
    downloadsDir: () => downloads,
    run
  })
  const event = { sender: { id: 1 } }
  return {
    handlers,
    run,
    call: (channel: string, raw: unknown) => handlers.get(channel)!(event, raw)
  }
}

const rejectMessage = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected rejection')
}

describe('screenshot 域', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.nativeImage.createFromBuffer.mockImplementation(() => ({
      getSize: () => ({ width: 1080, height: 2340 })
    }))
    downloads = await mkdtemp(join(tmpdir(), 'msd-shot-'))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('capture 成功：adb exec-out screencap、写系统剪贴板、返回 base64 与尺寸', async () => {
    const h = setup()
    const result = (await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })) as {
      pngBase64: string
      width: number
      height: number
    }
    expect(h.run).toHaveBeenCalledWith('/fake/adb', [
      '-s',
      'emulator-5554',
      'exec-out',
      'screencap',
      '-p'
    ])
    expect(mocks.clipboard.writeImage).toHaveBeenCalledTimes(1)
    expect(result.width).toBe(1080)
    expect(result.height).toBe(2340)
    expect(result.pngBase64).toBe(PNG.toString('base64'))
  })

  it('设备未运行：capture 拒绝且不碰剪贴板', async () => {
    const h = setup({ running: false })
    const message = await rejectMessage(h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' }))
    expect(message).toContain('screenshotDeviceNotRunning')
    expect(mocks.clipboard.writeImage).not.toHaveBeenCalled()
  })

  it('非主窗 sender：两通道都拒绝且报对各自通道名', async () => {
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    registerScreenshotIpc({
      adbPath: () => '/fake/adb',
      isMainSender: () => false,
      runningDevice: async () => ({ serial: 's', name: 'n' })
    })
    const captureMessage = await rejectMessage(
      handlers.get(IPC_CHANNELS.screenshotCapture)!({ sender: { id: 1 } }, { id: 'd1' })
    )
    expect(captureMessage).toContain('screenshot:capture')
    expect(captureMessage).toContain('unregisteredWindowSuffix')
    const saveMessage = await rejectMessage(
      handlers.get(IPC_CHANNELS.screenshotSave)!({ sender: { id: 1 } }, { id: 'd1' })
    )
    expect(saveMessage).toContain('screenshot:save')
    expect(saveMessage).toContain('unregisteredWindowSuffix')
  })

  it('capture 互斥：同设备进行中再调用直接拒绝', async () => {
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    let release: (() => void) | null = null
    registerScreenshotIpc({
      adbPath: () => '/fake/adb',
      isMainSender: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      run: (() =>
        new Promise<AdbBinaryResult>((resolve) => {
          release = () => resolve({ code: 0, stdout: PNG, stderr: '' })
        })) as unknown as typeof import('../index').runAdbBinary
    })
    const event = { sender: { id: 1 } }
    const first = handlers.get(IPC_CHANNELS.screenshotCapture)!(event, { id: 'd1' })
    const message = await rejectMessage(
      handlers.get(IPC_CHANNELS.screenshotCapture)!(event, { id: 'd1' })
    )
    expect(message).toBe('screenshotBusy')
    release!()
    await expect(first).resolves.toBeTruthy()
  })

  it('非 PNG 输出：capture 报失败并附 stderr 详情', async () => {
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    registerScreenshotIpc({
      adbPath: () => '/fake/adb',
      isMainSender: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      run: (async () => ({
        code: 1,
        stdout: Buffer.from('nope'),
        stderr: 'device offline'
      })) as unknown as typeof import('../index').runAdbBinary
    })
    const message = await rejectMessage(
      handlers.get(IPC_CHANNELS.screenshotCapture)!({ sender: { id: 1 } }, { id: 'd1' })
    )
    expect(message).toContain('screenshotCaptureFailed')
    expect(message).toContain('device offline')
  })

  it('save 成功：写入下载目录，文件名 = 净化设备名-时间戳.png', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const result = (await h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' })) as { fileName: string }
    expect(result.fileName).toMatch(/^测试设备-\d{8}-\d{6}\.png$/)
    const written = await readFile(join(downloads, result.fileName))
    expect(written.equals(PNG)).toBe(true)
  })

  it('save 重名递增：已存在的名字跳到 -2', async () => {
    const h = setup()
    const captured = (await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })) as unknown
    expect(captured).toBeTruthy()
    const files = await readdir(downloads)
    expect(files).toHaveLength(0)
    const first = (await h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' })) as { fileName: string }
    await writeFile(join(downloads, first.fileName), PNG)
    const second = (await h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' })) as { fileName: string }
    expect(second.fileName).toBe(first.fileName.replace(/\.png$/, '-2.png'))
  })

  it('缓存失效：未截屏或清理后 save 拒绝 stale', async () => {
    const h = setup()
    // cache 是模块级状态：上个用例截过 d1，先清保证「未截屏」前提
    clearScreenshotCache('d1')
    const stale = await rejectMessage(h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' }))
    expect(stale).toBe('screenshotStale')
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    clearScreenshotCache('d1')
    const afterClear = await rejectMessage(h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' }))
    expect(afterClear).toBe('screenshotStale')
  })

  it('save 写盘失败：报 screenshotSaveFailed 并附原因', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    // 目录换成不存在的路径触发 ENOENT
    downloads = join(downloads, 'missing')
    const message = await rejectMessage(h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' }))
    expect(message).toContain('screenshotSaveFailed')
  })

  it('save 互斥：同一保存未完成时再次调用直接拒绝', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const first = h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' })
    const message = await rejectMessage(h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' }))
    expect(message).toBe('screenshotSaveBusy')
    await expect(first).resolves.toBeTruthy()
  })

  it('截屏期间设备停止：capture 拒绝、不写剪贴板、不回填缓存', async () => {
    // cache 是模块级状态：先清掉之前用例截的 d1，保证「缓存为空」前提
    clearScreenshotCache('d1')
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    let probes = 0
    registerScreenshotIpc({
      adbPath: () => '/fake/adb',
      isMainSender: () => true,
      runningDevice: async () => {
        probes += 1
        return probes === 1 ? { serial: 's', name: 'n' } : null
      },
      run: (async () => ({ code: 0, stdout: PNG, stderr: '' })) as unknown as ScreenshotDeps['run']
    })
    const message = await rejectMessage(
      handlers.get(IPC_CHANNELS.screenshotCapture)!({ sender: { id: 1 } }, { id: 'd1' })
    )
    expect(message).toBe('screenshotDeviceNotRunning')
    expect(mocks.clipboard.writeImage).not.toHaveBeenCalled()
    const stale = await rejectMessage(
      handlers.get(IPC_CHANNELS.screenshotSave)!({ sender: { id: 1 } }, { id: 'd1' })
    )
    expect(stale).toBe('screenshotStale')
  })

  it('PNG 魔数合法但解码为 0×0：capture 失败且不写剪贴板', async () => {
    mocks.nativeImage.createFromBuffer.mockImplementationOnce(() => ({
      getSize: () => ({ width: 0, height: 0 })
    }))
    const h = setup()
    const message = await rejectMessage(h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' }))
    expect(message).toContain('screenshotCaptureFailed')
    expect(message).toContain('decoded 0×0')
    expect(mocks.clipboard.writeImage).not.toHaveBeenCalled()
  })
})

describe('runAdbBinary', () => {
  it('正常路径：收 Buffer stdout、退出码透传', async () => {
    const result = await runAdbBinary(process.execPath, ['-e', 'process.stdout.write("abc")'])
    expect(result.code).toBe(0)
    expect(result.stdout.toString('utf8')).toBe('abc')
  })

  it('stderr 有界尾部：超 4KiB 只保留尾部', async () => {
    const result = await runAdbBinary(process.execPath, [
      '-e',
      'process.stderr.write("x".repeat(8192))'
    ])
    expect(result.code).toBe(0)
    expect(result.stderr.length).toBe(4096)
  })

  it('超时：SIGKILL 并 resolve 超时文案（code -1、stdout 空）', async () => {
    const result = await runAdbBinary('/bin/sleep', ['5'], { timeoutMs: 150 })
    expect(result.code).toBe(-1)
    expect(result.stdout.length).toBe(0)
    expect(result.stderr).toContain('adbCommandTimeout')
  }, 10_000)

  it('超体积护栏：SIGKILL 并报 screenshotOversized', async () => {
    const result = await runAdbBinary(process.execPath, [
      '-e',
      'setInterval(() => process.stdout.write("0123456789abcdef".repeat(4096)), 1)'
    ])
    expect(result.code).toBe(-1)
    expect(result.stderr).toContain('screenshotOversized')
  }, 20_000)

  it('二进制不存在：reject', async () => {
    await expect(runAdbBinary('/no/such/adb', ['-s', 'x'])).rejects.toThrow()
  })
})

describe('文件名工具', () => {
  it('sanitizeFileSegment：替换路径非法字符、保留中文、空名兜底、60 字符截断', () => {
    expect(sanitizeFileSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFileSegment('  Pixel 8  ')).toBe('Pixel 8')
    expect(sanitizeFileSegment('设备')).toBe('设备')
    expect(sanitizeFileSegment('///')).toBe('___')
    expect(sanitizeFileSegment('   ')).toBe('device')
    expect(sanitizeFileSegment('x'.repeat(80))).toHaveLength(60)
  })

  it('formatShotStamp：本地时区 YYYYMMDD-HHmmss', () => {
    expect(formatShotStamp(new Date(2026, 9, 10, 13, 5, 9).getTime())).toBe('20261010-130509')
  })
})
