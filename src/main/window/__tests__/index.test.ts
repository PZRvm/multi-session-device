// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  registerTitleBar: vi.fn(),
  closeChild: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: function (options: unknown) {
    return mocks.construct(options)
  },
  shell: { openExternal: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../../app-icon', () => ({ appIcon: undefined }))
vi.mock('../../theme', () => ({
  themeWindowBackground: () => '#fff',
  themeWindowTitleBarOverlay: () => ({ height: 40, color: '#fff', symbolColor: '#111' }),
  registerWindowTitleBar: mocks.registerTitleBar
}))
vi.mock('../wizard', () => ({ closeWizardWindow: mocks.closeChild }))
vi.mock('../settings', () => ({ closeSettingsWindow: mocks.closeChild }))
vi.mock('../logcat', () => ({ closeLogcatWindow: mocks.closeChild }))
vi.mock('../report', () => ({ closeReportWindow: mocks.closeChild }))
vi.mock('../wireless', () => ({ closeWirelessWindow: mocks.closeChild }))
vi.mock('../../locale', () => ({ msg: () => '多会话设备' }))

const originalPlatform = process.platform
beforeEach(() => vi.clearAllMocks())
afterEach(() => Object.defineProperty(process, 'platform', { value: originalPlatform }))

describe('主窗平台顶部配置', () => {
  it.each(['win32', 'darwin', 'linux'])('%s 保留对应平台窗口样式', async (platform) => {
    Object.defineProperty(process, 'platform', { value: platform })
    const window = Object.assign(new EventEmitter(), {
      webContents: { setWindowOpenHandler: vi.fn() },
      loadFile: vi.fn(async () => undefined),
      isDestroyed: () => false,
      show: vi.fn()
    })
    mocks.construct.mockReturnValue(window)
    const { createMainWindow, getMainWindow } = await import('..')
    createMainWindow()
    const options = mocks.construct.mock.calls[0][0]
    expect(options).toMatchObject({ width: 900, height: 670, webPreferences: { sandbox: true } })
    if (platform === 'win32') {
      expect(options).toMatchObject({
        titleBarStyle: 'hidden',
        titleBarOverlay: { height: 40, color: '#fff', symbolColor: '#111' }
      })
      expect(mocks.registerTitleBar).toHaveBeenCalledWith(window)
    } else {
      expect(options).not.toHaveProperty('titleBarOverlay')
      expect(mocks.registerTitleBar).not.toHaveBeenCalled()
      if (platform === 'darwin') {
        expect(options).toMatchObject({
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 12 }
        })
      } else expect(options).not.toHaveProperty('titleBarStyle')
    }
    const preventDefault = vi.fn()
    window.emit('page-title-updated', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledOnce()
    expect(getMainWindow()).toBe(window)
    window.emit('closed')
    expect(getMainWindow()).toBeNull()
    expect(mocks.closeChild).toHaveBeenCalledTimes(5)
  })
})
