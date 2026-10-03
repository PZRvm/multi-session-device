// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  nativeTheme: { themeSource: 'system' }
}))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, nativeTheme: mocks.nativeTheme }))

import { registerThemeIpc } from '..'

describe('原生主题 IPC', () => {
  let handler: (event: unknown, mode: unknown) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nativeTheme.themeSource = 'system'
    registerThemeIpc()
    expect(mocks.handle.mock.calls[0][0]).toBe(IPC_CHANNELS.themeSetMode)
    handler = mocks.handle.mock.calls[0][1]
  })

  it.each(['light', 'dark', 'system'])('将 %s 应用到原生主题', (mode) => {
    mocks.nativeTheme.themeSource = 'dark'
    handler({}, mode)
    expect(mocks.nativeTheme.themeSource).toBe(mode)
  })

  it.each([undefined, null, '', 'auto', 1, {}, ['light']])(
    '拒绝非法模式 %j，保留原生主题',
    (mode) => {
      expect(() => handler({}, mode)).toThrow('非法的 mode')
      expect(mocks.nativeTheme.themeSource).toBe('system')
    }
  )
})
