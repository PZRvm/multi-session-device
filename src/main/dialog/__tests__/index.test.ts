// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  showMessageBox: vi.fn(
    async (_windowOrOptions: unknown, _options?: unknown) => ({ response: 0, checkboxChecked: false })
  ),
  fromWebContents: vi.fn(() => null)
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  dialog: { showMessageBox: mocks.showMessageBox },
  BrowserWindow: { fromWebContents: mocks.fromWebContents }
}))
vi.mock('../../app-icon', () => ({ appIcon: undefined }))
vi.mock('../../locale', () => ({
  msg: (key: string, params?: Record<string, unknown>): string =>
    key === 'dialogDetailTruncated'
      ? `TRUNC(${params?.omitted})`
      : key === 'invalidDialogOptions'
        ? 'INVALID'
        : `MSG(${key})`
}))

import { registerDialogIpc } from '../index'

const fakeEvent = { sender: { id: 7 } }
const handlerOf = (channel: string): ((payload: unknown) => Promise<unknown>) =>
  (payload: unknown) => mocks.handle.mock.calls.find(([name]) => name === channel)![1](fakeEvent, payload)

const shownOptions = (): { detail?: string } =>
  (mocks.showMessageBox.mock.calls[0][0] ??
    (mocks.showMessageBox.mock.calls[0][1] as { detail?: string })) as { detail?: string }

describe('dialog:show detail 行数预算（超长弹窗截断，2026-10-12 用户报障）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerDialogIpc()
  })

  const base = {
    title: 't',
    message: 'm',
    buttons: ['ok'],
    cancelId: 0
  }

  it('40 行以内原样透传；无 detail 不添加', async () => {
    await handlerOf('dialog:show')({ ...base, detail: 'a\nb\nc' })
    expect(shownOptions().detail).toBe('a\nb\nc')
    mocks.showMessageBox.mockClear()
    await handlerOf('dialog:show')(base)
    expect(shownOptions().detail).toBeUndefined()
  })

  it('超过 40 行：截到 40 行并附省略说明（按钮回到屏内）', async () => {
    const detail = Array.from({ length: 120 }, (_, i) => `line-${i}`).join('\n')
    await handlerOf('dialog:show')({ ...base, detail })
    const shown = shownOptions().detail as string
    const lines = shown.split('\n')
    expect(lines).toHaveLength(41)
    expect(lines[39]).toBe('line-39')
    expect(lines[40]).toBe('TRUNC(80)')
  })
})
