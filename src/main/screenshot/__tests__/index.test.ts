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

const mocks = vi.hoisted(() => {
  /** nativeImage 替身：尺寸与空态可控（isEmpty 返回 boolean，供 mockImplementationOnce 覆写） */
  const fakeImage = (width: number, height: number, empty = false) => ({
    getSize: () => ({ width, height }),
    isEmpty: () => empty
  })
  return {
    app: { getPath: vi.fn(() => '/tmp/downloads') },
    clipboard: { writeImage: vi.fn() },
    ipcMain: { handle: vi.fn() },
    nativeImage: { createFromBuffer: vi.fn(() => fakeImage(1080, 2340)) },
    fakeImage
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  clipboard: mocks.clipboard,
  ipcMain: mocks.ipcMain,
  nativeImage: mocks.nativeImage
}))

// 只Mock link：注入一次性 EEXIST（跨设备同名并发撞名的确定性模拟），其余 fs 原生；
// hook = link 执行前回调（模拟下载进行中设备停止清缓存）；blocked/unblock = 挂起 link
// （互斥时序用）
const linkFailures = vi.hoisted(() => ({
  remaining: 0,
  hook: null as (() => void) | null,
  blocked: false,
  unblock: null as (() => void) | null
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: (async (...args: Parameters<typeof actual.link>) => {
      linkFailures.hook?.()
      if (linkFailures.blocked) {
        await new Promise<void>((resolve) => {
          linkFailures.unblock = resolve
        })
      }
      if (linkFailures.remaining > 0) {
        linkFailures.remaining -= 1
        throw Object.assign(new Error('file exists already'), { code: 'EEXIST' })
      }
      return actual.link(...args)
    }) as typeof actual.link
  }
})

// msg 模板化会拉入 locale store——单测只需要稳定的键名拼串
vi.mock('../../locale', () => ({
  msg: (key: string, params?: Record<string, string | number>): string =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body')
])

/** 编辑成品（与采集 PNG 内容不同，供缓存更新与落盘内容断言） */
const EDIT_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('edited-body')
])
const EDIT_DATAURL = `data:image/png;base64,${EDIT_PNG.toString('base64')}`

interface Harness {
  handlers: Map<string, (event: unknown, raw: unknown) => Promise<unknown>>
  run: ReturnType<typeof vi.fn>
  openEditor: ReturnType<typeof vi.fn>
  /** 编辑窗 sender 事件：id 10 = 设备 d1 的编辑窗，id 20 = 设备 d2 的编辑窗 */
  eventA: unknown
  eventB: unknown
  eventMain: unknown
  call: (channel: string, raw: unknown) => Promise<unknown>
  callAs: (channel: string, raw: unknown, event: unknown) => Promise<unknown>
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
  const openEditor = vi.fn<NonNullable<ScreenshotDeps['openEditor']>>(async () => undefined)
  registerScreenshotIpc({
    adbPath: () => '/fake/adb',
    isMainSender: (sender) => (sender as { id: number }).id === 1,
    runningDevice: async () =>
      options?.running === false ? null : { serial: 'emulator-5554', name: '测试设备' },
    isRunningDevice: () => options?.running !== false,
    downloadsDir: () => downloads,
    openEditor,
    editorDeviceId: (sender) => {
      const id = (sender as { id: number }).id
      if (id === 10) return 'd1'
      if (id === 20) return 'd2'
      return null
    },
    run
  })
  const eventMain = { sender: { id: 1 } }
  const eventA = { sender: { id: 10 } }
  const eventB = { sender: { id: 20 } }
  return {
    handlers,
    run,
    openEditor,
    eventA,
    eventB,
    eventMain,
    call: (channel: string, raw: unknown) => handlers.get(channel)!(eventMain, raw),
    callAs: (channel: string, raw: unknown, event: unknown) => handlers.get(channel)!(event, raw)
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
    linkFailures.remaining = 0
    linkFailures.hook = null
    linkFailures.blocked = false
    linkFailures.unblock = null
    mocks.nativeImage.createFromBuffer.mockImplementation(() => mocks.fakeImage(1080, 2340))
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
      isRunningDevice: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      openEditor: async () => undefined,
      editorDeviceId: () => null
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
      isRunningDevice: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      openEditor: async () => undefined,
      editorDeviceId: () => null,
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
      isRunningDevice: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      openEditor: async () => undefined,
      editorDeviceId: () => null,
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

  it('save 撞名（link EEXIST）换候选重试成功，目录无 .part 残骸', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    linkFailures.remaining = 1
    const result = (await h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' })) as { fileName: string }
    const files = await readdir(downloads)
    expect(files).toHaveLength(1)
    expect(files[0]).toBe(result.fileName)
    expect(files.some((name) => name.endsWith('.part'))).toBe(false)
    expect(await readFile(join(downloads, result.fileName))).toEqual(PNG)
  })

  it('跨设备同名同秒并发保存：两文件各自落盘，互不覆盖互不串内容', async () => {
    vi.useFakeTimers()
    try {
      const h = setup()
      // 冻结时间：两设备 capturedAt 同秒 + 同名 → 基名相同（跨设备不共享 save 互斥）
      await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
      await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd2' })
      const [a, b] = (await Promise.all([
        h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' }),
        h.call(IPC_CHANNELS.screenshotSave, { id: 'd2' })
      ])) as Array<{ fileName: string }>
      expect(a.fileName).not.toBe(b.fileName)
      const files = await readdir(downloads)
      expect(files).toHaveLength(2)
      expect(files).toContain(a.fileName)
      expect(files).toContain(b.fileName)
      expect(files.some((name) => name.endsWith('.part'))).toBe(false)
      expect(await readFile(join(downloads, a.fileName))).toEqual(PNG)
      expect(await readFile(join(downloads, b.fileName))).toEqual(PNG)
    } finally {
      vi.useRealTimers()
    }
  })

  it('截屏期间设备停止：capture 拒绝、不写剪贴板、不回填缓存', async () => {
    // cache 是模块级状态：先清掉之前用例截的 d1，保证「缓存为空」前提
    clearScreenshotCache('d1')
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    registerScreenshotIpc({
      adbPath: () => '/fake/adb',
      isMainSender: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      openEditor: async () => undefined,
      editorDeviceId: () => null,
      // 尾段复核（同步）：adb 返回后设备已停——拒绝且不回填
      isRunningDevice: () => false,
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
    mocks.nativeImage.createFromBuffer.mockImplementationOnce(() => mocks.fakeImage(0, 0))
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

describe('文件名工具', () => {  it('sanitizeFileSegment：替换路径非法字符、保留中文、空名兜底、60 字符截断', () => {
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

describe('screenshot 编辑器域', () => {
  beforeEach(async () => {
    // cache 是模块级状态：清两台设备的缓存，保证用例前提干净
    clearScreenshotCache('d1')
    clearScreenshotCache('d2')
    // downloads 同为模块级：screenshot 域「写盘失败」用例会把它指到 missing
    // 子目录，这里重建保证编辑域写盘用例拿到存在的新目录
    downloads = await mkdtemp(join(tmpdir(), 'msd-shot-'))
  })

  const getEditImage = async (
    h: Harness,
    event: unknown
  ): Promise<{ captureId: string; dataUrl: string; width: number; height: number }> =>
    (await h.callAs(IPC_CHANNELS.screenshotGetEditImage, undefined, event)) as {
      captureId: string
      dataUrl: string
      width: number
      height: number
    }

  it('openEditor：主窗携缓存尺寸调用并等待就绪；空缓存不带尺寸', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    await h.call(IPC_CHANNELS.screenshotOpenEditor, { id: 'd1' })
    expect(h.openEditor).toHaveBeenCalledWith('d1', { imageWidth: 1080, imageHeight: 2340 })
    await h.call(IPC_CHANNELS.screenshotOpenEditor, { id: 'd2' })
    expect(h.openEditor).toHaveBeenLastCalledWith('d2', undefined)
  })

  it('openEditor：非主窗拒绝；载荷非法拒绝', async () => {
    const h = setup()
    const denied = await rejectMessage(
      h.callAs(IPC_CHANNELS.screenshotOpenEditor, { id: 'd1' }, { sender: { id: 10 } })
    )
    expect(denied).toContain('screenshot:open-editor')
    expect(denied).toContain('unregisteredWindowSuffix')
    const bad = await rejectMessage(h.call(IPC_CHANNELS.screenshotOpenEditor, { id: 5 }))
    expect(bad).toContain('invalidPayload')
  })

  it('getEditImage：编辑窗按 sender 归属取本设备缓存（captureId + dataUrl + 尺寸）', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd2' })
    const a = await getEditImage(h, h.eventA)
    const b = await getEditImage(h, h.eventB)
    expect(a.captureId).toBeTruthy()
    expect(a.captureId).not.toBe(b.captureId)
    expect(a.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(a.width).toBe(1080)
    expect(a.height).toBe(2340)
  })

  it('getEditImage：主窗/未知 sender 拒绝；空缓存报 stale', async () => {
    const h = setup()
    const fromMain = await rejectMessage(
      h.callAs(IPC_CHANNELS.screenshotGetEditImage, undefined, { sender: { id: 1 } })
    )
    expect(fromMain).toContain('screenshot:get-edit-image')
    expect(fromMain).toContain('unregisteredWindowSuffix')
    const unknown = await rejectMessage(
      h.callAs(IPC_CHANNELS.screenshotGetEditImage, undefined, { sender: { id: 99 } })
    )
    expect(unknown).toContain('unregisteredWindowSuffix')
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const empty = await rejectMessage(
      h.callAs(IPC_CHANNELS.screenshotGetEditImage, undefined, { sender: { id: 30 } })
    )
    expect(empty).toContain('unregisteredWindowSuffix')
  })

  it('getEditImage：设备无缓存（他设备有）报 stale', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const stale = await rejectMessage(h.callAs(IPC_CHANNELS.screenshotGetEditImage, undefined, { sender: { id: 20 } }))
    expect(stale).toBe('screenshotStale')
  })

  it('editCopy：写剪贴板、缓存换新 id 与新图；他设备缓存不受影响', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd2' })
    const before = await getEditImage(h, h.eventA)
    // capture 成功也写系统剪贴板：断言取增量，只验证 editCopy 的那次写入
    const clipCalls = mocks.clipboard.writeImage.mock.calls.length
    await h.callAs(
      IPC_CHANNELS.screenshotEditCopy,
      { captureId: before.captureId, dataUrl: EDIT_DATAURL },
      h.eventA
    )
    expect(mocks.clipboard.writeImage).toHaveBeenCalledTimes(clipCalls + 1)
    const after = await getEditImage(h, h.eventA)
    expect(after.captureId).not.toBe(before.captureId)
    expect(after.dataUrl).toBe(`data:image/png;base64,${EDIT_PNG.toString('base64')}`)
    // 设备 B 缓存仍是自己的采集图
    const b = await getEditImage(h, h.eventB)
    expect(b.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('editCopy：同设备新截屏令旧 id 过期；错设备 id 报 stale', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const before = await getEditImage(h, h.eventA)
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const stale = await rejectMessage(
      h.callAs(
        IPC_CHANNELS.screenshotEditCopy,
        { captureId: before.captureId, dataUrl: EDIT_DATAURL },
        h.eventA
      )
    )
    expect(stale).toBe('screenshotStale')
    // B 编辑窗持 A 的旧 id：对账落 B 自己的缓存（先给 B 建缓存，走 id
    // 不匹配分支而非空缓存分支）→ stale
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd2' })
    const bImage = await getEditImage(h, h.eventB)
    expect(bImage.captureId).toBeTruthy()
    const cross = await rejectMessage(
      h.callAs(
        IPC_CHANNELS.screenshotEditCopy,
        { captureId: before.captureId, dataUrl: EDIT_DATAURL },
        { sender: { id: 20 } }
      )
    )
    expect(cross).toBe('screenshotStale')
  })

  it('editCopy：非法载荷（前缀/超长/空 id/超长 id/空图）拒绝且不碰剪贴板不换 id', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const before = await getEditImage(h, h.eventA)
    const badPayloads: Array<Record<string, unknown>> = [
      { captureId: before.captureId, dataUrl: `data:image/jpeg;base64,${EDIT_PNG.toString('base64')}` },
      { captureId: before.captureId, dataUrl: `data:image/png;base64,${'A'.repeat(30_000_001)}` },
      { captureId: '', dataUrl: EDIT_DATAURL },
      { captureId: 'x'.repeat(129), dataUrl: EDIT_DATAURL },
      { captureId: before.captureId, dataUrl: 'data:image/png;base64,' }
    ]
    for (const payload of badPayloads) {
      const message = await rejectMessage(
        h.callAs(IPC_CHANNELS.screenshotEditCopy, payload, h.eventA)
      )
      expect(message).toContain('invalidPayload')
    }
    mocks.nativeImage.createFromBuffer.mockImplementationOnce(() => mocks.fakeImage(0, 0, true))
    const clipCalls = mocks.clipboard.writeImage.mock.calls.length
    const emptyImage = await rejectMessage(
      h.callAs(
        IPC_CHANNELS.screenshotEditCopy,
        { captureId: before.captureId, dataUrl: EDIT_DATAURL },
        h.eventA
      )
    )
    expect(emptyImage).toContain('invalidPayload')
    // 全部失败路径不碰剪贴板（capture 的写入之外零新增）
    expect(mocks.clipboard.writeImage).toHaveBeenCalledTimes(clipCalls)
    // 失败不换 captureId：现值仍可正常对账使用
    const after = await getEditImage(h, h.eventA)
    expect(after.captureId).toBe(before.captureId)
  })

  it('editDownload：文件按保存时刻命名、内容为成品、缓存换新 id 可续编', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const before = await getEditImage(h, h.eventA)
    const result = (await h.callAs(
      IPC_CHANNELS.screenshotEditDownload,
      { captureId: before.captureId, dataUrl: EDIT_DATAURL },
      h.eventA
    )) as { fileName: string }
    expect(result.fileName).toMatch(/^测试设备-\d{8}-\d{6}\.png$/)
    expect(await readFile(join(downloads, result.fileName))).toEqual(EDIT_PNG)
    const files = await readdir(downloads)
    expect(files.some((name) => name.endsWith('.part'))).toBe(false)
    // 缓存换新 id 与新图：旧 id 后续导出过期，新 id 可继续复制
    const stale = await rejectMessage(
      h.callAs(
        IPC_CHANNELS.screenshotEditCopy,
        { captureId: before.captureId, dataUrl: EDIT_DATAURL },
        h.eventA
      )
    )
    expect(stale).toBe('screenshotStale')
    const after = await getEditImage(h, h.eventA)
    expect(after.captureId).not.toBe(before.captureId)
    // capture 与续编 editCopy 各写一次剪贴板：从续编前取增量断言
    const clipCalls = mocks.clipboard.writeImage.mock.calls.length
    await h.callAs(
      IPC_CHANNELS.screenshotEditCopy,
      { captureId: after.captureId, dataUrl: EDIT_DATAURL },
      h.eventA
    )
    expect(mocks.clipboard.writeImage).toHaveBeenCalledTimes(clipCalls + 1)
  })

  it('editDownload：写盘失败报错、缓存不换 id、无半截文件', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const before = await getEditImage(h, h.eventA)
    downloads = join(downloads, 'missing')
    const message = await rejectMessage(
      h.callAs(
        IPC_CHANNELS.screenshotEditDownload,
        { captureId: before.captureId, dataUrl: EDIT_DATAURL },
        h.eventA
      )
    )
    expect(message).toContain('screenshotSaveFailed')
    const after = await getEditImage(h, h.eventA)
    expect(after.captureId).toBe(before.captureId)
  })

  it('editDownload 期间缓存被清：下载如实成功、缓存不回填', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const before = await getEditImage(h, h.eventA)
    // link 执行前（文件已写入、终名未占）模拟设备停止清缓存
    linkFailures.hook = () => clearScreenshotCache('d1')
    const result = (await h.callAs(
      IPC_CHANNELS.screenshotEditDownload,
      { captureId: before.captureId, dataUrl: EDIT_DATAURL },
      h.eventA
    )) as { fileName: string }
    expect(result.fileName).toMatch(/^测试设备-\d{8}-\d{6}\.png$/)
    expect(await readFile(join(downloads, result.fileName))).toEqual(EDIT_PNG)
    // 缓存已清不复活：取图如实报 stale
    const stale = await rejectMessage(
      h.callAs(IPC_CHANNELS.screenshotGetEditImage, undefined, h.eventA)
    )
    expect(stale).toBe('screenshotStale')
  })

  it('编辑与保存共用占位：editDownload 进行中再次 editCopy/save 拒绝 busy', async () => {
    const h = setup()
    await h.call(IPC_CHANNELS.screenshotCapture, { id: 'd1' })
    const before = await getEditImage(h, h.eventA)
    linkFailures.blocked = true
    const first = h.callAs(
      IPC_CHANNELS.screenshotEditDownload,
      { captureId: before.captureId, dataUrl: EDIT_DATAURL },
      h.eventA
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    const busyCopy = await rejectMessage(
      h.callAs(
        IPC_CHANNELS.screenshotEditCopy,
        { captureId: before.captureId, dataUrl: EDIT_DATAURL },
        h.eventA
      )
    )
    expect(busyCopy).toBe('screenshotSaveBusy')
    const busySave = await rejectMessage(h.call(IPC_CHANNELS.screenshotSave, { id: 'd1' }))
    expect(busySave).toBe('screenshotSaveBusy')
    linkFailures.blocked = false
    linkFailures.unblock!()
    await expect(first).resolves.toBeTruthy()
  })

  it('截屏进行中 editCopy 拒绝 busy', async () => {
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>()
    mocks.ipcMain.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
    let release: (() => void) | null = null
    registerScreenshotIpc({
      adbPath: () => '/fake/adb',
      isMainSender: () => true,
      isRunningDevice: () => true,
      runningDevice: async () => ({ serial: 's', name: 'n' }),
      openEditor: async () => undefined,
      editorDeviceId: (sender) => ((sender as { id: number }).id === 10 ? 'd1' : null),
      run: (() =>
        new Promise<AdbBinaryResult>((resolve) => {
          release = () => resolve({ code: 0, stdout: PNG, stderr: '' })
        })) as unknown as typeof import('../index').runAdbBinary
    })
    const eventMain = { sender: { id: 1 } }
    const eventA = { sender: { id: 10 } }
    const first = handlers.get(IPC_CHANNELS.screenshotCapture)!(eventMain, { id: 'd1' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    // capture 已占位（adb 进行中）：编辑窗此刻复制/下载都反馈截屏 busy
    for (const channel of [IPC_CHANNELS.screenshotEditCopy, IPC_CHANNELS.screenshotEditDownload]) {
      const message = await rejectMessage(
        handlers.get(channel)!(eventA, { captureId: 'whatever', dataUrl: EDIT_DATAURL })
      )
      expect(message).toBe('screenshotBusy')
    }
    release!()
    // 收尾对齐 capture 互斥用例先例：第一次走完 finally 释放占位即证明链路健康
    await expect(first).resolves.toBeTruthy()
  })
})
