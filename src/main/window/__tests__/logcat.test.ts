// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  handle: vi.fn(),
  main: null as unknown as MainWindowMock | null
}))

vi.mock('electron', () => ({
  BrowserWindow: Object.assign(function () {
    return mocks.construct()
  }, {}),
  ipcMain: { handle: mocks.handle }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../../app-icon', () => ({ appIcon: undefined }))
vi.mock('../../theme', () => ({ themeWindowBackground: () => '#fff' }))
vi.mock('../../locale', () => ({ msg: (key: string) => key }))
vi.mock('..', () => ({ getMainWindow: () => mocks.main }))

/** 主窗替身：外框/内容宽可分别设置（模拟 Windows 帧差） */
class MainWindowMock extends EventEmitter {
  id: number
  webContents = { id: 1 }
  destroyed = false
  outer = { width: 900, height: 670 }
  inner = { width: 886, height: 656 }
  setContentSize = vi.fn()
  constructor(id: number) {
    super()
    this.id = id
  }
  getBounds = (): { width: number; height: number } => ({ ...this.outer })
  getContentBounds = (): { width: number; height: number } => ({ ...this.inner })
  isDestroyed = (): boolean => this.destroyed
}

/** 独立日志窗替身（openLogcatWindow 用；webContents 需独立 id 与 sender 判定） */
type LogcatWebContents = EventEmitter & {
  id: number
  setWindowOpenHandler: () => { action: string }
}
class LogcatWindowMock extends EventEmitter {
  webContents: LogcatWebContents = Object.assign(new EventEmitter(), {
    id: 42,
    setWindowOpenHandler: () => ({ action: 'deny' })
  }) as LogcatWebContents
  destroyed = false
  show = vi.fn()
  focus = vi.fn()
  loadURL = vi.fn(() => new Promise<void>(() => {}))
  isDestroyed = (): boolean => this.destroyed
  close = (): void => {
    this.destroyed = true
    this.emit('closed')
  }
}

let module: typeof import('../logcat')
let main: MainWindowMock
let logcatWindows: LogcatWindowMock[]

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:1234')
  main = new MainWindowMock(1)
  mocks.main = main
  logcatWindows = []
  mocks.construct.mockImplementation(() => {
    const window = new LogcatWindowMock()
    logcatWindows.push(window)
    return window
  })
  module = await import('../logcat')
  module.registerLogcatIpc()
})

afterEach(() => {
  module.closeLogcatWindow()
  vi.unstubAllEnvs()
})

const handlerOf = (channel: string): ((...args: unknown[]) => unknown) =>
  mocks.handle.mock.calls.find(([name]) => name === channel)![1]

const mainEvent = (): { sender: unknown } => ({ sender: mocks.main?.webContents })

const expand = (minWidth: number): unknown =>
  handlerOf(IPC_CHANNELS.logcatDockState)(mainEvent(), { expanded: true, minWidth })

const collapse = (): unknown =>
  handlerOf(IPC_CHANNELS.logcatDockState)(mainEvent(), { expanded: false })

const emitWillResize = (width: number): { preventDefault: ReturnType<typeof vi.fn> } => {
  const event = { preventDefault: vi.fn() }
  main.emit('will-resize', event, { width, height: 670, x: 0, y: 0 })
  return event
}

const emitResize = (): void => {
  main.emit('resize')
}

describe('dock 展开态宽钳制（内容坐标口径）', () => {
  it('内容宽不足：按内容尺寸拉宽（外框帧差不参与），已足宽不重复拉', () => {
    main.outer = { width: 914, height: 670 }
    main.inner = { width: 900, height: 656 } // Windows 型帧差 14px
    expand(1200)
    // 用内容坐标比较与拉宽：setContentSize(1200, 656)——不是 setSize(1200, 外框高)
    expect(main.setContentSize).toHaveBeenCalledTimes(1)
    expect(main.setContentSize).toHaveBeenCalledWith(1200, 656)
    // 再次上报同需求：内容已足（模拟拉宽已生效），不重复拉宽
    main.outer = { width: 1214, height: 670 }
    main.inner = { width: 1200, height: 656 }
    main.setContentSize.mockClear()
    expand(1200)
    expect(main.setContentSize).not.toHaveBeenCalled()
  })

  it('分数缩放取整：内容高带 .5 时 setContentSize 收整数', () => {
    main.inner = { width: 900, height: 656.5 }
    expand(1200)
    expect(main.setContentSize).toHaveBeenCalledWith(1200, 657)
  })

  it('will-resize 预阻止按内容宽折算：外框帧差不放进阈值', () => {
    main.outer = { width: 1214, height: 670 }
    main.inner = { width: 1200, height: 656 } // 帧差 14
    expand(1200)
    main.setContentSize.mockClear()
    // 拖到外框 1210：内容宽 1196 < 1200 → 阻止（旧口径比外框 1210 ≥ 1200 会放行——P2-1）
    expect(emitWillResize(1210).preventDefault).toHaveBeenCalledTimes(1)
    // 拖到外框 1215：内容宽 1201 ≥ 1200 → 放行
    expect(emitWillResize(1215).preventDefault).not.toHaveBeenCalled()
    // 收起后不再钳制
    collapse()
    expect(emitWillResize(600).preventDefault).not.toHaveBeenCalled()
  })

  it('程序化缩窄（resize 事件）：内容宽低于阈值时回弹到 min', () => {
    main.inner = { width: 1200, height: 656 }
    expand(1200)
    // 外力（窗口服务器异常路径）把内容缩到 1100
    main.inner = { width: 1100, height: 656 }
    main.outer = { width: 1114, height: 670 }
    emitResize()
    expect(main.setContentSize).toHaveBeenCalledWith(1200, 656)
  })

  it('主窗重开（id 更换）后钳制钩子按新窗重挂', () => {
    expand(1200)
    const reopened = new MainWindowMock(2)
    reopened.outer = { width: 914, height: 670 }
    reopened.inner = { width: 900, height: 656 }
    mocks.main = reopened
    expand(1200)
    expect(reopened.setContentSize).toHaveBeenCalledWith(1200, 656)
    reopened.inner = { width: 1100, height: 656 }
    reopened.emit('resize')
    expect(reopened.setContentSize).toHaveBeenCalledWith(1200, 656)
  })

  it('dockState 载荷与 sender 校验', () => {
    expect(() => handlerOf(IPC_CHANNELS.logcatDockState)(mainEvent(), null)).toThrow(
      'logcat:dock-state'
    )
    expect(() => handlerOf(IPC_CHANNELS.logcatDockState)(mainEvent(), { expanded: true })).toThrow(
      'logcatInvalidPayloadSuffix'
    )
    expect(() =>
      handlerOf(IPC_CHANNELS.logcatDockState)({ sender: { id: 99 } }, { expanded: false })
    ).toThrow('logcatMainOnlySuffix')
  })
})

describe('独立日志窗与主窗解锁', () => {
  it('独立窗 ready 即清主窗宽钳制（不依赖 renderer 解锁时序）', async () => {
    main.inner = { width: 1200, height: 656 }
    expand(1200)
    const opened = module.openLogcatWindow('d1')
    await Promise.resolve()
    expect(logcatWindows).toHaveLength(1)
    logcatWindows[0].emit('ready-to-show')
    await opened
    expect(logcatWindows[0].show).toHaveBeenCalledTimes(1)
    // 钳制已清：外力缩窄不再回弹
    main.inner = { width: 700, height: 656 }
    main.setContentSize.mockClear()
    emitResize()
    expect(main.setContentSize).not.toHaveBeenCalled()
    // 窗口态查询：ready 后为 true
    expect(handlerOf(IPC_CHANNELS.logcatWindowState)(mainEvent(), undefined)).toBe(true)
  })

  it('windowOpen 非 main sender 拒绝；windowState 未开窗为 false', () => {
    expect(() =>
      handlerOf(IPC_CHANNELS.logcatWindowOpen)({ sender: { id: 99 } }, { deviceId: 'd1' })
    ).toThrow('logcatMainOnlySuffix')
    expect(handlerOf(IPC_CHANNELS.logcatWindowState)(mainEvent(), undefined)).toBe(false)
  })
})
