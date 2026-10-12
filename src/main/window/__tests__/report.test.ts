// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  handle: vi.fn(),
  main: { webContents: { id: 1 } },
  dev: true
}))
vi.mock('electron', () => ({
  BrowserWindow: function (options: unknown) {
    return mocks.construct(options)
  },
  ipcMain: { handle: mocks.handle },
  app: { getPath: vi.fn(() => '/userdata') }
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
vi.mock('..', () => ({ getMainWindow: () => mocks.main }))

class TestWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), { id: 2, setWindowOpenHandler: vi.fn() })
  destroyed = false
  show = vi.fn()
  focus = vi.fn()
  loadURL = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}))
  loadFile = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}))
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

let module: typeof import('../report') | undefined
let windows: TestWindow[]
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:1234')
  mocks.dev = true
  windows = []
  mocks.construct.mockImplementation(() => {
    const window = new TestWindow()
    windows.push(window)
    return window
  })
  module = await import('../report')
})
afterEach(() => {
  module?.closeReportWindow()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const handlerOf = (channel: string): ((...args: unknown[]) => unknown) =>
  mocks.handle.mock.calls.find(([name]) => name === channel)![1]

describe('对账详情窗（plan 2026-10-12-reconcile-report-panel 子窗口方案）', () => {
  it('开窗：单例复用聚焦、560 布局参数与 sandbox、darwin 三灯', async () => {
    const first = module!.openReportWindow()
    expect(module!.openReportWindow()).toBe(first)
    expect(windows).toHaveLength(1)
    expect(mocks.construct.mock.calls[0][0]).toMatchObject({
      width: 620,
      height: 520,
      minWidth: 480,
      show: false,
      minimizable: false,
      fullscreenable: true,
      webPreferences: { sandbox: true }
    })
    if (process.platform === 'darwin') {
      expect(mocks.construct.mock.calls[0][0]).toMatchObject({
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 14, y: 12 }
      })
    }
    windows[0].emit('ready-to-show')
    await first
    await module!.openReportWindow()
    expect(windows[0].show).toHaveBeenCalledTimes(1)
    expect(windows[0].focus).toHaveBeenCalledTimes(2)
  })

  it('非主窗 sender 拒绝 report-window:open；主窗放行', () => {
    module!.registerReportIpc()
    const foreign = { sender: { id: 99 } }
    expect(() => handlerOf(IPC_CHANNELS.reportWindowOpen)(foreign)).toThrow()
    const main = { sender: mocks.main.webContents }
    void handlerOf(IPC_CHANNELS.reportWindowOpen)(main) // 不抛（开窗挂起，fake timers 下无碍）
  })

  it('就绪后 renderer 崩溃：释放单例销毁残窗，可重开（对账窗特有分支）', async () => {
    const first = module!.openReportWindow()
    windows[0].emit('ready-to-show')
    await first
    windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    const second = module!.openReportWindow()
    expect(windows).toHaveLength(2)
    windows[1].emit('ready-to-show')
    await second
    expect(windows[1].show).toHaveBeenCalledTimes(1)
  })

  it('主窗关闭联动 closeReportWindow 销毁残窗', async () => {
    const pending = module!.openReportWindow()
    windows[0].emit('ready-to-show')
    await pending
    module!.closeReportWindow()
    expect(windows[0].destroyed).toBe(true)
    const again = module!.openReportWindow()
    windows[1].emit('ready-to-show')
    await again
    expect(windows).toHaveLength(2)
  })
})
