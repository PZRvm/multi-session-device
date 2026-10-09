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
  ipcMain: { handle: mocks.handle }
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
  setWindowButtonVisibility = vi.fn()
  loadURL = vi.fn<(path: string) => Promise<void>>(() => new Promise<void>(() => {}))
  loadFile = vi.fn<(path: string) => Promise<void>>(() => new Promise<void>(() => {}))
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

let module: typeof import('../settings') | undefined
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
  module = await import('../settings')
})
afterEach(() => {
  module?.closeSettingsWindow()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const handlerOf = (channel: string): ((...args: unknown[]) => unknown) =>
  mocks.handle.mock.calls.find(([name]) => name === channel)![1]

describe('设置窗口边界', () => {
  it('并发打开共享结果；就绪后只聚焦，保持独立与 sandbox', async () => {
    const first = module!.openSettingsWindow()
    expect(module!.openSettingsWindow()).toBe(first)
    expect(windows).toHaveLength(1)
    expect(mocks.construct.mock.calls[0][0]).toMatchObject({
      width: 760,
      height: 560,
      minWidth: 640,
      minHeight: 460,
      show: false,
      minimizable: false,
      fullscreenable: false,
      webPreferences: { sandbox: true }
    })
    expect(mocks.construct.mock.calls[0][0]).not.toHaveProperty('parent')
    if (process.platform === 'darwin') {
      // 原生三灯模式：hiddenInset 度量沿用向导窗，整组灯保持系统自管
      expect(mocks.construct.mock.calls[0][0]).toMatchObject({
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 14, y: 12 }
      })
      expect(windows[0].setWindowButtonVisibility).not.toHaveBeenCalled()
    }
    windows[0].emit('ready-to-show')
    await first
    await module!.openSettingsWindow()
    expect(windows[0].show).toHaveBeenCalledTimes(1)
    expect(windows[0].focus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['loadURL', 'loadFile'] as const)(
    '%s 失败释放会话，迟到事件不影响重试',
    async (method) => {
      mocks.dev = method === 'loadURL'
      const old = new TestWindow()
      old[method].mockRejectedValue(new Error('page unavailable'))
      mocks.construct.mockReturnValueOnce(old)
      await expect(module!.openSettingsWindow()).rejects.toThrow('page unavailable')
      expect(old.destroy).toHaveBeenCalledTimes(1)
      const retry = module!.openSettingsWindow()
      old.emit('closed')
      old.emit('ready-to-show')
      expect(module!.openSettingsWindow()).toBe(retry)
      windows[0].emit('ready-to-show')
      await retry
      expect(old.show).not.toHaveBeenCalled()
    }
  )

  it('加载超时或主 frame/渲染进程故障均拒绝并清理', async () => {
    for (const reason of ['timeout', 'frame', 'renderer']) {
      const pending = module!.openSettingsWindow()
      const rejection = expect(pending).rejects.toThrow('加载设置窗口失败')
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
    await expect(module!.openSettingsWindow()).rejects.toThrow('construct failed')
    const pending = module!.openSettingsWindow()
    module!.closeSettingsWindow()
    await expect(pending).resolves.toBeUndefined()
    windows[0].emit('ready-to-show')
    expect(windows[0].show).not.toHaveBeenCalled()
  })

  it('dev/prod 都加载设置入口', async () => {
    for (const dev of [true, false]) {
      mocks.dev = dev
      const pending = module!.openSettingsWindow()
      const window = windows.at(-1)!
      if (dev) expect(window.loadURL).toHaveBeenCalledWith('http://localhost:1234/settings.html')
      else expect(window.loadFile.mock.calls[0][0]).toMatch(/renderer\/settings\.html$/)
      module!.closeSettingsWindow()
      await pending
    }
  })

  it('只登记主窗开窗桥，窗口控制回归系统原生不经 renderer', async () => {
    module!.registerSettingsIpc()
    expect(mocks.handle.mock.calls.map(([name]) => name)).toEqual([IPC_CHANNELS.settingsOpen])
    const open = handlerOf(IPC_CHANNELS.settingsOpen)
    expect(() => open({ sender: { id: 99 } })).toThrow('仅主窗')
    const pending = open({ sender: mocks.main.webContents })
    expect(() => open({ sender: windows[0].webContents })).toThrow('仅主窗')
    windows[0].emit('ready-to-show')
    await pending
  })
})
