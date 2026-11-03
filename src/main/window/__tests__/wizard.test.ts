// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  fromWebContents: vi.fn(),
  handle: vi.fn(),
  main: { webContents: { id: 1 } },
  dev: true
}))

vi.mock('electron', () => ({
  BrowserWindow: Object.assign(
    function () {
      return mocks.construct()
    },
    { fromWebContents: mocks.fromWebContents }
  ),
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
  webContents = new EventEmitter()
  destroyed = false
  show = vi.fn()
  focus = vi.fn()
  loadURL = vi.fn(() => new Promise<void>(() => {}))
  loadFile = vi.fn(() => new Promise<void>(() => {}))
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

let module: typeof import('../wizard')
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
  mocks.fromWebContents.mockImplementation((sender) =>
    sender === mocks.main.webContents ? mocks.main : windows.find((w) => w.webContents === sender)
  )
  module = await import('../wizard')
})

afterEach(() => {
  module.closeWizardWindow()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const handlerOf = (channel: string): ((...args: unknown[]) => unknown) =>
  mocks.handle.mock.calls.find(([name]) => name === channel)![1]

describe('向导加载生命周期', () => {
  it('同上下文共享 ready 结果，成功后再次打开只聚焦', async () => {
    const first = module.openWizardWindow()
    const second = module.openWizardWindow()
    expect(first).toBeInstanceOf(Promise)
    expect(second).toBe(first)
    expect(windows).toHaveLength(1)
    const done = vi.fn()
    void first.then(done)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    windows[0].emit('ready-to-show')
    await first
    expect(windows[0].show).toHaveBeenCalledTimes(1)
    await module.openWizardWindow()
    expect(windows[0].focus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['loadURL', 'loadFile'] as const)('%s 拒绝清理窗口并允许重试', async (method) => {
    mocks.dev = method === 'loadURL'
    const window = new TestWindow()
    window[method].mockRejectedValue(new Error('page unavailable'))
    mocks.construct.mockReturnValueOnce(window)
    await expect(module.openWizardWindow()).rejects.toThrow('page unavailable')
    expect(window.destroy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    const retry = module.openWizardWindow()
    windows[0].emit('ready-to-show')
    await retry
  })

  it('仅主 frame 加载失败收口；重复故障只拒绝一次且不显示旧窗', async () => {
    const pending = module.openWizardWindow()
    const rejection = expect(pending).rejects.toThrow('ERR_CONNECTION_REFUSED')
    const window = windows[0]
    window.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'url', false)
    expect(window.destroy).not.toHaveBeenCalled()
    window.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'url', true)
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    window.emit('ready-to-show')
    await rejection
    expect(window.destroy).toHaveBeenCalledTimes(1)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('就绪前渲染进程退出解除互斥，就绪后不冒充加载失败', async () => {
    const first = module.openWizardWindow()
    const failed = expect(first).rejects.toThrow('crashed')
    windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await failed
    const second = module.openWizardWindow()
    windows[1].emit('ready-to-show')
    await second
    windows[1].webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(windows[1].destroy).not.toHaveBeenCalled()
  })

  it('15 秒未 ready 时超时销毁，后续可打开', async () => {
    const pending = module.openWizardWindow()
    const failed = expect(pending).rejects.toThrow('15 秒')
    await vi.advanceTimersByTimeAsync(15000)
    await failed
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    const retry = module.openWizardWindow()
    windows[1].emit('ready-to-show')
    await retry
  })

  it('主动关闭按取消成功收口；旧 closed/ready/rejection 不影响新编辑上下文', async () => {
    let rejectLoad!: (error: Error) => void
    const old = new TestWindow()
    old.loadURL.mockReturnValue(
      new Promise((_, reject) => {
        rejectLoad = reject
      })
    )
    mocks.construct.mockReturnValueOnce(old)
    const first = module.openWizardWindow()
    module.closeWizardWindow()
    await expect(first).resolves.toBeUndefined()
    const context = { kind: 'edit' as const, deviceId: 'target' }
    const second = module.openWizardWindow(context)
    old.emit('closed')
    old.emit('ready-to-show')
    rejectLoad(new Error('old rejection'))
    await Promise.resolve()
    const current = windows[0]
    expect(module.wizardContextOf(current.webContents as Electron.WebContents)).toEqual(context)
    expect(module.wizardOwns(old.webContents as Electron.WebContents)).toBe(false)
    current.emit('ready-to-show')
    await second
    expect(old.show).not.toHaveBeenCalled()
    expect(current.destroy).not.toHaveBeenCalled()
  })

  it('构造失败也解除保留状态', async () => {
    mocks.construct.mockImplementationOnce(() => {
      throw new Error('constructor failure')
    })
    await expect(module.openWizardWindow()).rejects.toThrow('constructor failure')
    const retry = module.openWizardWindow()
    windows[0].emit('ready-to-show')
    await retry
  })

  it('不同上下文保持冲突，原向导权限与编辑 sender 守卫仍有效', async () => {
    module.registerWizardIpc()
    expect(() => handlerOf(IPC_CHANNELS.wizardOpen)({ sender: {} })).toThrow('无法定位')
    const pending = handlerOf(IPC_CHANNELS.wizardOpen)({ sender: mocks.main.webContents })
    expect(pending).toBeInstanceOf(Promise)
    await expect(module.openWizardWindow({ kind: 'edit', deviceId: 'other' })).rejects.toThrow(
      '先关闭'
    )
    expect(() => handlerOf(IPC_CHANNELS.wizardClose)({ sender: mocks.main.webContents })).toThrow(
      '非向导窗'
    )
    await expect(
      handlerOf(IPC_CHANNELS.wizardOpenEditor)({ sender: {} }, { id: 'bad' })
    ).rejects.toThrow('仅主窗')
    await expect(
      handlerOf(IPC_CHANNELS.wizardOpenEditor)({ sender: mocks.main.webContents }, { id: 'bad' })
    ).rejects.toThrow('非法')
    expect(() => handlerOf(IPC_CHANNELS.wizardContext)({ sender: mocks.main.webContents })).toThrow(
      '非向导窗'
    )
    windows[0].emit('ready-to-show')
    await pending
  })

  it('向导自身关闭也静默取消，并拒绝迟到上下文读取', async () => {
    module.registerWizardIpc()
    const pending = module.openWizardWindow()
    const sender = windows[0].webContents
    handlerOf(IPC_CHANNELS.wizardClose)({ sender })
    await expect(pending).resolves.toBeUndefined()
    expect(windows[0].close).toHaveBeenCalledTimes(1)
    expect(module.wizardOwns(sender as Electron.WebContents)).toBe(false)
    expect(() => handlerOf(IPC_CHANNELS.wizardContext)({ sender })).toThrow('非向导窗')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('编辑核验成功后 IPC 等待窗口 ready；核验失败不创建窗口', async () => {
    const assertEditorTarget = vi
      .fn()
      .mockRejectedValueOnce(new Error('不可编辑'))
      .mockResolvedValue(undefined)
    module.registerWizardIpc({ assertEditorTarget })
    const context = { id: '5e5b1d65-19e0-4e9e-bbdc-615ed2370762' }
    const open = handlerOf(IPC_CHANNELS.wizardOpenEditor)
    await expect(open({ sender: mocks.main.webContents }, context)).rejects.toThrow('不可编辑')
    expect(windows).toHaveLength(0)
    const pending = open({ sender: mocks.main.webContents }, context)
    await Promise.resolve()
    expect(windows).toHaveLength(1)
    const done = vi.fn()
    void Promise.resolve(pending).then(done)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    windows[0].emit('ready-to-show')
    await pending
    expect(module.wizardContextOf(windows[0].webContents as Electron.WebContents)).toEqual({
      kind: 'edit',
      deviceId: context.id
    })
  })
})
