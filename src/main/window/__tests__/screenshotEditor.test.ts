// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  dev: true,
  /** 主屏工作区（尺寸自适应算例锚点：avail = 1000−160×2 = 840 宽、784 高） */
  workAreaSize: { width: 1000, height: 1000 }
}))
vi.mock('electron', () => ({
  BrowserWindow: function (options: unknown) {
    return mocks.construct(options)
  },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: mocks.workAreaSize }) }
}))
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return mocks.dev
    }
  }
}))
vi.mock('../../app-icon', () => ({ appIcon: undefined }))
vi.mock('../../theme', () => ({ themeWindowBackground: () => '#fff' }))

class TestWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    id: 2,
    ipc: new EventEmitter(),
    mainFrame: {},
    getZoomFactor: vi.fn(() => 1),
    setWindowOpenHandler: vi.fn()
  })
  getContentBounds = (): { height: number } => ({ height: 520 })
  setWindowButtonPosition = vi.fn()
  destroyed = false
  show = vi.fn()
  focus = vi.fn()
  minimized = false
  isMinimized = (): boolean => this.minimized
  restore = vi.fn(() => {
    this.minimized = false
  })
  loadURL = vi.fn<(path: string) => Promise<void>>(() => new Promise<void>(() => {}))
  loadFile = vi.fn<(path: string, options?: { query?: Record<string, string> }) => Promise<void>>(
    () => new Promise<void>(() => {})
  )
  isDestroyed = (): boolean => this.destroyed
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('closed')
  })
  destroy = vi.fn(() => {
    this.destroyed = true
    this.emit('closed')
  })
}

let module: typeof import('../screenshotEditor') | undefined
let windows: TestWindow[]
/** TestWindow.webContents → Electron.WebContents（测试替身只需 id/事件面，类型视图收窄） */
const senderOf = (window: TestWindow): Electron.WebContents =>
  window.webContents as unknown as Electron.WebContents
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:1234')
  mocks.dev = true
  windows = []
  mocks.construct.mockImplementation(() => {
    const window = new TestWindow()
    window.webContents.id = 2 + windows.length
    windows.push(window)
    return window
  })
  module = await import('../screenshotEditor')
})
afterEach(() => {
  module?.closeAllScreenshotEditorWindows()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('截图编辑窗边界（设备单例）', () => {
  it('macOS 三灯随本窗工具栏换行和恢复单行居中，忽略异常高度及子 frame', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const pending = module!.openScreenshotEditorWindow('d1')
    const window = windows[0]
    expect(mocks.construct.mock.calls[0][0]).toMatchObject({
      trafficLightPosition: { x: 14, y: 16 }
    })
    const resize = (height: unknown, senderFrame = window.webContents.mainFrame): void => {
      window.webContents.ipc.emit(
        IPC_CHANNELS.screenshotEditorToolbarHeight,
        { senderFrame },
        height
      )
    }
    resize(69)
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 27 })
    resize(48)
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 16 })
    for (const height of [undefined, '69', NaN, Infinity, -1, 0, 47, 521]) resize(height)
    resize(69, {})
    expect(window.setWindowButtonPosition).toHaveBeenCalledTimes(2)
    window.emit('ready-to-show')
    await pending
    window.close()
    resize(69)
    expect(window.setWindowButtonPosition).toHaveBeenCalledTimes(2)
  })

  it('Windows 不注册 macOS 三灯定位通道', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const pending = module!.openScreenshotEditorWindow('d1')
    const window = windows[0]
    expect(mocks.construct.mock.calls[0][0]).not.toHaveProperty('trafficLightPosition')
    expect(window.webContents.ipc.listenerCount(IPC_CHANNELS.screenshotEditorToolbarHeight)).toBe(0)
    window.emit('ready-to-show')
    await pending
  })

  it('页面缩放时按 DIP 定位，接受最小高度的亚像素误差并按 DIP 校验窗高', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const pending = module!.openScreenshotEditorWindow('d1')
    const window = windows[0]
    const resize = (height: number, zoom: number): void => {
      window.webContents.getZoomFactor.mockReturnValue(zoom)
      window.webContents.ipc.emit(
        IPC_CHANNELS.screenshotEditorToolbarHeight,
        { senderFrame: window.webContents.mainFrame },
        height
      )
    }
    resize(68.8, 1.25)
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 35 })
    resize(47.998, 0.8)
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 11 })
    resize(48, 1.25)
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 22 })
    // CSS 高度未超窗高，但换算为 DIP 后已超出，不能移动原生按钮。
    resize(500, 1.25)
    expect(window.setWindowButtonPosition).toHaveBeenCalledTimes(3)
    // 缩小时较大的 CSS 高度仍可处于实际窗口范围内。
    resize(600, 0.8)
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 14, y: 232 })
    window.emit('ready-to-show')
    await pending
  })

  it('重新打开最小化编辑窗先还原再聚焦，不重建', async () => {
    const first = module!.openScreenshotEditorWindow('d1')
    windows[0].emit('ready-to-show')
    await first
    windows[0].minimized = true
    windows[0].focus.mockClear()
    await module!.openScreenshotEditorWindow('d1')
    expect(windows).toHaveLength(1)
    expect(windows[0].minimized).toBe(false)
    expect(windows[0].restore.mock.invocationCallOrder[0]).toBeLessThan(
      windows[0].focus.mock.invocationCallOrder[0]
    )
  })

  it('同设备并发打开共享结果；就绪后聚焦不重建；窗口形态与 sandbox 沿项目先例', async () => {
    const first = module!.openScreenshotEditorWindow('d1')
    expect(module!.openScreenshotEditorWindow('d1')).toBe(first)
    expect(windows).toHaveLength(1)
    expect(mocks.construct.mock.calls[0][0]).toMatchObject({
      show: false,
      useContentSize: true,
      resizable: true,
      autoHideMenuBar: true,
      webPreferences: { sandbox: true }
    })
    expect(mocks.construct.mock.calls[0][0]).not.toHaveProperty('parent')
    windows[0].emit('ready-to-show')
    await first
    await module!.openScreenshotEditorWindow('d1')
    expect(windows).toHaveLength(1)
    expect(windows[0].show).toHaveBeenCalledTimes(1)
    expect(windows[0].focus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('不同设备各开各窗；sender 归属按登记表解析，未知来源与无窗均为 null', async () => {
    const a = module!.openScreenshotEditorWindow('d1')
    const b = module!.openScreenshotEditorWindow('d2')
    expect(windows).toHaveLength(2)
    windows[0].emit('ready-to-show')
    windows[1].emit('ready-to-show')
    await Promise.all([a, b])
    expect(module!.screenshotEditorDeviceId(senderOf(windows[0]))).toBe('d1')
    expect(module!.screenshotEditorDeviceId(senderOf(windows[1]))).toBe('d2')
    expect(module!.screenshotEditorDeviceId({ id: 99 } as never)).toBeNull()
    // 就绪前归属同样可解析（编辑窗取图发生在 ready-to-show 前后皆可）
    const c = module!.openScreenshotEditorWindow('d3')
    expect(module!.screenshotEditorDeviceId(senderOf(windows[2]))).toBe('d3')
    windows[2].emit('ready-to-show')
    await c
  })

  it('尺寸自适应：按主屏工作区只缩不放，度量与 query 携显示值（迁源算法）', async () => {
    // 工作区 1000×1000 → 可用 840×784；图 1680×1568 → scale = 0.5（二进制精确）
    const pending = module!.openScreenshotEditorWindow('d1', {
      imageWidth: 1680,
      imageHeight: 1568
    })
    expect(mocks.construct.mock.calls[0][0]).toMatchObject({
      width: 840,
      height: 840,
      minWidth: 720,
      minHeight: 280
    })
    expect(windows[0].loadURL).toHaveBeenCalledWith(
      'http://localhost:1234/screenshot-editor.html?scale=0.5&imgWidth=1680&imgHeight=1568'
    )
    windows[0].emit('ready-to-show')
    await pending
    // 小图不放大：度量夹到下限，scale 仍为 1
    const small = module!.openScreenshotEditorWindow('d2', {
      imageWidth: 200,
      imageHeight: 150
    })
    expect(mocks.construct.mock.calls[1][0]).toMatchObject({
      width: 720,
      height: 280,
      minWidth: 720
    })
    expect(windows[1].loadURL).toHaveBeenCalledWith(
      'http://localhost:1234/screenshot-editor.html?scale=1&imgWidth=200&imgHeight=150'
    )
    windows[1].emit('ready-to-show')
    await small
    // 空缓存开窗：默认度量，不携尺寸 query
    const empty = module!.openScreenshotEditorWindow('d3')
    expect(mocks.construct.mock.calls[2][0]).toMatchObject({
      width: 800,
      height: 520,
      minWidth: 720
    })
    expect(windows[2].loadURL).toHaveBeenCalledWith('http://localhost:1234/screenshot-editor.html')
    windows[2].emit('ready-to-show')
    await empty
  })

  it('就绪后 renderer 崩溃：销毁残窗并释放该设备会话，再次打开重建新窗', async () => {
    const first = module!.openScreenshotEditorWindow('d1')
    windows[0].emit('ready-to-show')
    await first
    windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    const second = module!.openScreenshotEditorWindow('d1')
    expect(windows).toHaveLength(2)
    windows[1].emit('ready-to-show')
    await second
    expect(windows[1].show).toHaveBeenCalledTimes(1)
    expect(windows[0].focus).toHaveBeenCalledTimes(1)
  })

  it.each(['loadURL', 'loadFile'] as const)(
    '%s 失败释放该设备会话，迟到事件不影响重试',
    async (method) => {
      mocks.dev = method === 'loadURL'
      const old = new TestWindow()
      old[method].mockRejectedValue(new Error('page unavailable'))
      mocks.construct.mockReturnValueOnce(old)
      await expect(module!.openScreenshotEditorWindow('d1')).rejects.toThrow('page unavailable')
      expect(old.destroy).toHaveBeenCalledTimes(1)
      const retry = module!.openScreenshotEditorWindow('d1')
      old.emit('closed')
      old.emit('ready-to-show')
      expect(module!.openScreenshotEditorWindow('d1')).toBe(retry)
      windows[0].emit('ready-to-show')
      await retry
      expect(old.show).not.toHaveBeenCalled()
    }
  )

  it('加载超时或主 frame/渲染进程故障均拒绝并清理', async () => {
    for (const reason of ['timeout', 'frame', 'renderer']) {
      const pending = module!.openScreenshotEditorWindow('d1')
      const rejection = expect(pending).rejects.toThrow('打开截图编辑器窗口失败')
      const window = windows.at(-1)!
      window.webContents.emit('did-fail-load', {}, -102, 'subframe', '', false)
      expect(window.destroy).not.toHaveBeenCalled()
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(15_000)
      if (reason === 'frame')
        window.webContents.emit('did-fail-load', {}, -102, 'offline', '', true)
      if (reason === 'renderer')
        window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      await rejection
      expect(window.destroy).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('构造失败可以重试，加载中关闭正常结算', async () => {
    mocks.construct.mockImplementationOnce(() => {
      throw new Error('construct failed')
    })
    await expect(module!.openScreenshotEditorWindow('d1')).rejects.toThrow('construct failed')
    const pending = module!.openScreenshotEditorWindow('d1')
    module!.closeAllScreenshotEditorWindows()
    await expect(pending).resolves.toBeUndefined()
    windows[0].emit('ready-to-show')
    expect(windows[0].show).not.toHaveBeenCalled()
  })

  it('dev/prod 都加载截图编辑窗入口（prod query 走 loadFile）', async () => {
    for (const dev of [true, false]) {
      mocks.dev = dev
      const pending = module!.openScreenshotEditorWindow('d1', {
        imageWidth: 1680,
        imageHeight: 1568
      })
      const window = windows.at(-1)!
      if (dev)
        expect(window.loadURL).toHaveBeenCalledWith(
          'http://localhost:1234/screenshot-editor.html?scale=0.5&imgWidth=1680&imgHeight=1568'
        )
      else
        expect(window.loadFile).toHaveBeenCalledWith(
          // 平台无关分隔符（Windows 下 join 产物是反斜杠）
          expect.stringMatching(/renderer[\\/]screenshot-editor\.html$/),
          { query: { scale: '0.5', imgWidth: '1680', imgHeight: '1568' } }
        )
      module!.closeAllScreenshotEditorWindows()
      await pending
    }
  })

  it('关闭主窗级联清空全部编辑窗，归属登记随之失效', async () => {
    const a = module!.openScreenshotEditorWindow('d1')
    const b = module!.openScreenshotEditorWindow('d2')
    windows[0].emit('ready-to-show')
    windows[1].emit('ready-to-show')
    await Promise.all([a, b])
    module!.closeAllScreenshotEditorWindows()
    expect(windows[0].close).toHaveBeenCalledTimes(1)
    expect(windows[1].close).toHaveBeenCalledTimes(1)
    expect(module!.screenshotEditorDeviceId(senderOf(windows[0]))).toBeNull()
    expect(module!.screenshotEditorDeviceId(senderOf(windows[1]))).toBeNull()
    // 用户手动关单窗：只释放自己的登记，他窗不受影响
    const c = module!.openScreenshotEditorWindow('d1')
    windows[2].emit('ready-to-show')
    await c
    windows[1].emit('closed')
    expect(module!.screenshotEditorDeviceId(senderOf(windows[1]))).toBeNull()
    expect(module!.screenshotEditorDeviceId(senderOf(windows[2]))).toBe('d1')
  })

  it('旧会话迟到事件不清理新窗口（代次守卫）', async () => {
    const first = module!.openScreenshotEditorWindow('d1')
    // 先挂断言再推进时钟：reject 瞬间 handler 已就位，不留 unhandled rejection 窗口
    const rejection = expect(first).rejects.toThrow('打开截图编辑器窗口失败')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    // 首窗超时失败释放 → 重建二窗；此后首窗的迟到 closed 不应动二窗登记
    const second = module!.openScreenshotEditorWindow('d1')
    windows[0].emit('closed')
    windows[1].emit('ready-to-show')
    await second
    expect(module!.screenshotEditorDeviceId(senderOf(windows[1]))).toBe('d1')
    expect(windows[1].show).toHaveBeenCalledTimes(1)
  })
})
