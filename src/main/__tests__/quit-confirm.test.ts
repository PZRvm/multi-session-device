// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mocks = vi.hoisted(() => ({
  showMessageBox: vi.fn<
    (options: Record<string, unknown>) => Promise<{ response: number; checkboxChecked: boolean }>
  >(async () => ({ response: 0, checkboxChecked: false }))
}))
vi.mock('electron', () => ({ dialog: { showMessageBox: mocks.showMessageBox } }))
vi.mock('../app-icon', () => ({ appIcon: undefined }))
vi.mock('../locale', () => ({
  msg: (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`
}))

import {
  confirmQuitIfNeeded,
  markSessionEnding,
  resetSessionEndingForTest,
  reviveMainWindow
} from '../quit-confirm'

beforeEach(() => {
  resetSessionEndingForTest()
  mocks.showMessageBox.mockReset()
  mocks.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
})

describe('Windows 关窗确认（quit-confirm）', () => {
  it('win32 且有设备在跑：弹原生确认，选「退出」放行', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await expect(confirmQuitIfNeeded({ platform: 'win32', runningCount: () => 2 })).resolves.toBe(
      true
    )
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1)
    const options = mocks.showMessageBox.mock.calls[0]![0] as Record<string, unknown>
    expect(options['type']).toBe('warning')
    expect(options['title']).toBe('quitConfirmTitle')
    expect(options['message']).toBe('quitConfirmMessage:{"count":2}')
    expect(options['detail']).toBe('quitConfirmDetail')
    expect(options['buttons']).toEqual(['quitStayButton', 'quitConfirmQuitButton'])
    expect(options['cancelId']).toBe(0)
  })

  it('选「留在应用」→ 返回 false（调用方折返）', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await expect(confirmQuitIfNeeded({ platform: 'win32', runningCount: () => 1 })).resolves.toBe(
      false
    )
  })

  it('win32 但没有设备在跑 → 直接放行，不弹窗', async () => {
    await expect(confirmQuitIfNeeded({ platform: 'win32', runningCount: () => 0 })).resolves.toBe(
      true
    )
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })

  it('mac（darwin）恒放行，不弹窗——关窗本就不退出', async () => {
    await expect(confirmQuitIfNeeded({ platform: 'darwin', runningCount: () => 3 })).resolves.toBe(
      true
    )
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })

  it('ask 接缝：自定义确认交互收到同构参数，索引 0 之外放行', async () => {
    const ask = vi.fn(async () => 1)
    await expect(
      confirmQuitIfNeeded({ platform: 'win32', runningCount: () => 1, ask })
    ).resolves.toBe(true)
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'quitConfirmTitle', cancelId: 0 })
    )
  })

  it('会话结束旁路（注入）：win32 且有设备在跑也不弹窗，直接放行——系统关机不能被模态框挂住', async () => {
    await expect(
      confirmQuitIfNeeded({ platform: 'win32', runningCount: () => 2, sessionEnding: true })
    ).resolves.toBe(true)
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })

  it('会话结束旁路（模块标记）：markSessionEnding 后同样放行', async () => {
    markSessionEnding()
    await expect(confirmQuitIfNeeded({ platform: 'win32', runningCount: () => 1 })).resolves.toBe(
      true
    )
    expect(mocks.showMessageBox).not.toHaveBeenCalled()
  })
})

describe('second-instance 唤回（reviveMainWindow）', () => {
  const makeWindow = (
    minimized: boolean
  ): { isMinimized: Mock<() => boolean>; restore: Mock<() => void>; focus: Mock<() => void> } => ({
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    focus: vi.fn()
  })

  it('主窗在场且最小化：还原后聚焦，不重建', () => {
    const win = makeWindow(true)
    const createMainWindow = vi.fn()
    reviveMainWindow({ getMainWindow: () => win, createMainWindow })
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(createMainWindow).not.toHaveBeenCalled()
  })

  it('主窗在场未最小化：只聚焦，不还原', () => {
    const win = makeWindow(false)
    reviveMainWindow({ getMainWindow: () => win, createMainWindow: vi.fn() })
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('主窗不在（关窗折返「留在应用」后已销毁）：重建主窗', () => {
    const createMainWindow = vi.fn()
    reviveMainWindow({ getMainWindow: () => null, createMainWindow })
    expect(createMainWindow).toHaveBeenCalledTimes(1)
  })
})
