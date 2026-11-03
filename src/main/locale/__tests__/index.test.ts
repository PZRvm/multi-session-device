// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => {
  const windows = [{ webContents: { send: vi.fn() } }, { webContents: { send: vi.fn() } }]
  return {
    handle: vi.fn(),
    on: vi.fn(),
    windows,
    loadLocaleState: vi.fn(),
    getLocaleState: vi.fn(),
    updateLocaleState: vi.fn(),
    persistLocaleState: vi.fn()
  }
})
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle, on: mocks.on },
  BrowserWindow: { getAllWindows: () => mocks.windows }
}))
vi.mock('../store', () => ({
  loadLocaleState: mocks.loadLocaleState,
  getLocaleState: mocks.getLocaleState,
  updateLocaleState: mocks.updateLocaleState,
  persistLocaleState: mocks.persistLocaleState
}))

import { registerLocaleIpc, restoreLocale } from '..'

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

describe('locale 域主进程接线', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.persistLocaleState.mockResolvedValue(undefined)
    mocks.loadLocaleState.mockResolvedValue(undefined)
    mocks.getLocaleState.mockReturnValue('zh-CN')
    registerLocaleIpc()
  })

  it('restoreLocale 只读盘恢复内存态（无建窗副作用）', async () => {
    await restoreLocale()
    expect(mocks.loadLocaleState).toHaveBeenCalledTimes(1)
  })

  it('注册 locale:set（handle）与 locale:get-sync（on + returnValue）', () => {
    expect(mocks.handle.mock.calls.map((call) => call[0])).toEqual([IPC_CHANNELS.localeSet])
    expect(mocks.on).toHaveBeenCalledWith(IPC_CHANNELS.localeGetSync, expect.any(Function))
  })

  it('get-sync 以内存快照应答（不读盘）', () => {
    mocks.getLocaleState.mockReturnValue('en-US')
    const event: { returnValue: unknown } = { returnValue: undefined }
    ;(syncListenerOf(IPC_CHANNELS.localeGetSync) as (e: typeof event) => void)(event)
    expect(event.returnValue).toEqual({ locale: 'en-US' })
    expect(mocks.loadLocaleState).not.toHaveBeenCalled()
  })

  it('set 合法：内存 → 全窗广播 → 落盘', async () => {
    mocks.getLocaleState.mockReturnValue('zh-TW')
    await handlerOf(IPC_CHANNELS.localeSet)({}, 'zh-TW')
    expect(mocks.updateLocaleState).toHaveBeenCalledWith('zh-TW')
    for (const window of mocks.windows) {
      expect(window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.localeChanged, {
        locale: 'zh-TW'
      })
    }
    expect(mocks.persistLocaleState).toHaveBeenCalledTimes(1)
  })

  it('set 落盘失败：广播已发生（本次会话生效），错误向调用方抛出', async () => {
    mocks.getLocaleState.mockReturnValue('zh-TW')
    mocks.persistLocaleState.mockRejectedValueOnce(new Error('磁盘满'))
    await expect(handlerOf(IPC_CHANNELS.localeSet)({}, 'zh-TW')).rejects.toThrow('磁盘满')
    expect(mocks.updateLocaleState).toHaveBeenCalledWith('zh-TW')
    expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.localeChanged, {
      locale: 'zh-TW'
    })
  })

  it.each([undefined, null, '', 'fr-FR', 'ZH-cn', 1, {}, ['zh-CN']])(
    'set 拒绝非法 locale %j：不碰内存、广播与落盘',
    async (locale) => {
      await expect(handlerOf(IPC_CHANNELS.localeSet)({}, locale)).rejects.toThrow('非法的 locale')
      expect(mocks.updateLocaleState).not.toHaveBeenCalled()
      expect(mocks.persistLocaleState).not.toHaveBeenCalled()
      for (const window of mocks.windows) {
        expect(window.webContents.send).not.toHaveBeenCalled()
      }
    }
  )
})
