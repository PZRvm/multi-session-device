// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { resolveThemeMode, THEME_SYSTEMS } from '@shared/themeSystems'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => {
  const nativeTheme = {
    themeSource: 'system' as string,
    shouldUseDarkColors: false,
    on: vi.fn()
  }
  const windows = [
    { setBackgroundColor: vi.fn(), webContents: { send: vi.fn() } },
    { setBackgroundColor: vi.fn(), webContents: { send: vi.fn() } }
  ]
  return {
    handle: vi.fn(),
    on: vi.fn(),
    nativeTheme,
    windows,
    loadThemeState: vi.fn(),
    getThemeState: vi.fn(),
    updateThemeState: vi.fn(),
    persistThemeState: vi.fn()
  }
})
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle, on: mocks.on },
  nativeTheme: mocks.nativeTheme,
  BrowserWindow: { getAllWindows: () => mocks.windows }
}))
vi.mock('../store', () => ({
  loadThemeState: mocks.loadThemeState,
  getThemeState: mocks.getThemeState,
  updateThemeState: mocks.updateThemeState,
  persistThemeState: mocks.persistThemeState
}))

import {
  registerThemeIpc,
  registerWindowTitleBar,
  restoreTheme,
  themeWindowBackground,
  themeWindowTitleBarOverlay
} from '..'

type Handler = (...args: unknown[]) => unknown

const handlerOf = (channel: string): Handler => {
  const call = mocks.handle.mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`未注册 ${channel}`)
  return call[1] as Handler
}

const syncListenerOf = (channel: string): Handler => {
  const call = mocks.on.mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`未注册 ${channel}`)
  return call[1] as Handler
}

describe('主题域主进程接线', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.persistThemeState.mockResolvedValue(undefined)
    mocks.loadThemeState.mockResolvedValue(undefined)
    mocks.nativeTheme.themeSource = 'system'
    mocks.nativeTheme.shouldUseDarkColors = false
    mocks.getThemeState.mockReturnValue({ systemId: 'amber', mode: 'system', fresh: false })
    registerThemeIpc()
  })

  describe('resolveThemeMode（shared 单源）', () => {
    it('显式亮暗直读，system 由解析结果决定', () => {
      expect(resolveThemeMode('light', true)).toBe('light')
      expect(resolveThemeMode('dark', false)).toBe('dark')
      expect(resolveThemeMode('system', true)).toBe('dark')
      expect(resolveThemeMode('system', false)).toBe('light')
    })
  })

  describe('Windows 原生按钮覆盖层', () => {
    it.each(['amber', 'mist', 'moss'] as const)('%s 首帧颜色取同一主题 token', (systemId) => {
      for (const mode of ['light', 'dark'] as const) {
        mocks.getThemeState.mockReturnValue({ systemId, mode, fresh: false })
        expect(themeWindowTitleBarOverlay()).toEqual({
          height: 40,
          color: THEME_SYSTEMS[systemId][mode].bg,
          symbolColor: THEME_SYSTEMS[systemId][mode].ink
        })
      }
    })

    it.each(['win32', 'darwin', 'linux'])('%s 只刷新登记的 Windows 覆盖层', async (platform) => {
      const originalPlatform = process.platform
      const target = {
        setBackgroundColor: vi.fn(),
        setTitleBarOverlay: vi.fn(),
        webContents: { send: vi.fn() }
      }
      const plain = { ...target, setTitleBarOverlay: vi.fn() }
      mocks.windows.push(target, plain)
      Object.defineProperty(process, 'platform', { value: platform })
      try {
        registerWindowTitleBar(target as unknown as BrowserWindow)
        mocks.getThemeState.mockReturnValue({ systemId: 'moss', mode: 'dark', fresh: false })
        await handlerOf(IPC_CHANNELS.themeSetMode)({}, 'dark')
        await handlerOf(IPC_CHANNELS.themeSetSystemId)({}, 'moss')
        mocks.getThemeState.mockReturnValue({ systemId: 'mist', mode: 'system', fresh: false })
        mocks.nativeTheme.shouldUseDarkColors = true
        await restoreTheme()
        ;(mocks.nativeTheme.on.mock.calls[0][1] as () => void)()
        if (platform === 'win32') {
          expect(target.setTitleBarOverlay).toHaveBeenCalledTimes(3)
          expect(target.setTitleBarOverlay).toHaveBeenLastCalledWith({
            height: 40,
            color: THEME_SYSTEMS.mist.dark.bg,
            symbolColor: THEME_SYSTEMS.mist.dark.ink
          })
        } else expect(target.setTitleBarOverlay).not.toHaveBeenCalled()
        expect(plain.setTitleBarOverlay).not.toHaveBeenCalled()
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
        mocks.windows.splice(-2)
      }
    })
  })

  describe('themeWindowBackground：token 单源派生建窗底色', () => {
    it('显式暗态 = 该系统暗板面底', () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'amber', mode: 'dark', fresh: false })
      expect(themeWindowBackground()).toBe(THEME_SYSTEMS.amber.dark.bg)
    })

    it('system 按 shouldUseDarkColors 解析', () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'moss', mode: 'system', fresh: false })
      mocks.nativeTheme.shouldUseDarkColors = true
      expect(themeWindowBackground()).toBe(THEME_SYSTEMS.moss.dark.bg)
    })
  })

  describe('restoreTheme：boot 先恢复原生再供建窗取底色', () => {
    it('读盘后设置 themeSource，登记系统翻转监听', async () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'amber', mode: 'dark', fresh: false })
      await restoreTheme()
      expect(mocks.loadThemeState).toHaveBeenCalledTimes(1)
      expect(mocks.nativeTheme.themeSource).toBe('dark')
      expect(mocks.nativeTheme.on).toHaveBeenCalledWith('updated', expect.any(Function))
    })

    it('跟随系统时系统翻转只刷窗口底色', async () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'amber', mode: 'system', fresh: false })
      mocks.nativeTheme.shouldUseDarkColors = true
      await restoreTheme()
      ;(mocks.nativeTheme.on.mock.calls[0][1] as () => void)()
      for (const window of mocks.windows) {
        expect(window.setBackgroundColor).toHaveBeenCalledWith(THEME_SYSTEMS.amber.dark.bg)
      }
    })

    it('显式模式时系统翻转不动窗口', async () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'amber', mode: 'light', fresh: false })
      await restoreTheme()
      ;(mocks.nativeTheme.on.mock.calls[0][1] as () => void)()
      for (const window of mocks.windows) {
        expect(window.setBackgroundColor).not.toHaveBeenCalled()
      }
    })
  })

  describe('IPC', () => {
    it('注册 set-mode / set-system-id（handle）与 get-sync（on + returnValue）', () => {
      expect(mocks.handle.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining([IPC_CHANNELS.themeSetMode, IPC_CHANNELS.themeSetSystemId])
      )
      expect(mocks.on).toHaveBeenCalledWith(IPC_CHANNELS.themeGetSync, expect.any(Function))
    })

    it('get-sync 以内存快照应答（不读盘）', () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'mist', mode: 'dark', fresh: true })
      const event: { returnValue: unknown } = { returnValue: undefined }
      ;(syncListenerOf(IPC_CHANNELS.themeGetSync) as (e: typeof event) => void)(event)
      expect(event.returnValue).toEqual({ systemId: 'mist', mode: 'dark', fresh: true })
      expect(mocks.loadThemeState).not.toHaveBeenCalled()
    })

    it('set-mode 合法：内存 → 原生 → 全窗底色 → 广播 → 落盘', async () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'amber', mode: 'dark', fresh: false })
      await handlerOf(IPC_CHANNELS.themeSetMode)({}, 'dark')
      expect(mocks.updateThemeState).toHaveBeenCalledWith({ mode: 'dark' })
      expect(mocks.nativeTheme.themeSource).toBe('dark')
      for (const window of mocks.windows) {
        expect(window.setBackgroundColor).toHaveBeenCalledWith(THEME_SYSTEMS.amber.dark.bg)
        expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.themeChanged, {
          systemId: 'amber',
          mode: 'dark'
        })
      }
      expect(mocks.persistThemeState).toHaveBeenCalledTimes(1)
    })

    it.each([undefined, null, '', 'auto', 1, {}, ['light']])(
      'set-mode 拒绝非法模式 %j：不碰内存与落盘',
      async (mode) => {
        await expect(handlerOf(IPC_CHANNELS.themeSetMode)({}, mode)).rejects.toThrow('非法的 mode')
        expect(mocks.updateThemeState).not.toHaveBeenCalled()
        expect(mocks.persistThemeState).not.toHaveBeenCalled()
        expect(mocks.nativeTheme.themeSource).toBe('system')
      }
    )

    it('set-system-id 合法：内存 → 全窗底色 → 广播 → 落盘，不动原生', async () => {
      mocks.getThemeState.mockReturnValue({ systemId: 'moss', mode: 'system', fresh: false })
      mocks.nativeTheme.shouldUseDarkColors = true
      mocks.nativeTheme.themeSource = 'dark'
      await handlerOf(IPC_CHANNELS.themeSetSystemId)({}, 'moss')
      expect(mocks.updateThemeState).toHaveBeenCalledWith({ systemId: 'moss' })
      for (const window of mocks.windows) {
        expect(window.setBackgroundColor).toHaveBeenCalledWith(THEME_SYSTEMS.moss.dark.bg)
        expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.themeChanged, {
          systemId: 'moss',
          mode: 'system'
        })
      }
      expect(mocks.nativeTheme.themeSource).toBe('dark')
      expect(mocks.persistThemeState).toHaveBeenCalledTimes(1)
    })

    it.each(['amber!', 1, null])('set-system-id 拒绝非法值 %j', async (systemId) => {
      await expect(handlerOf(IPC_CHANNELS.themeSetSystemId)({}, systemId)).rejects.toThrow(
        '非法的 systemId'
      )
      expect(mocks.updateThemeState).not.toHaveBeenCalled()
      expect(mocks.persistThemeState).not.toHaveBeenCalled()
    })
  })
})
