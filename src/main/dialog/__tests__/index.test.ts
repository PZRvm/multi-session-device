// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  showMessageBox: vi.fn<
    (
      windowOrOptions: unknown,
      options?: unknown
    ) => Promise<{
      response: number
      checkboxChecked: boolean
    }>
  >(async () => ({
    response: 0,
    checkboxChecked: false
  })),
  fromWebContents: vi.fn(() => null),
  showItemInFolder: vi.fn(async () => undefined),
  appGetPath: vi.fn(() => '/userdata')
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  dialog: { showMessageBox: mocks.showMessageBox },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  shell: { showItemInFolder: mocks.showItemInFolder },
  app: { getPath: mocks.appGetPath }
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
const handlerOf =
  (channel: string): ((payload: unknown) => Promise<unknown>) =>
  (payload: unknown) =>
    mocks.handle.mock.calls.find(([name]) => name === channel)![1](fakeEvent, payload)

const shownOptions = (): { detail?: string } =>
  (mocks.showMessageBox.mock.calls[0][0] ??
    (mocks.showMessageBox.mock.calls[0][1] as { detail?: string })) as { detail?: string }

describe('dialog:show detail 行数预算（超长弹窗截断，2026-10-12 用户报障）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks 清掉 getPath 的实现——shell 白名单依赖它，逐用例重设
    mocks.appGetPath.mockImplementation(() => '/userdata')
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

describe('shell:show-item-in-folder 白名单（review P1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appGetPath.mockImplementation(() => '/userdata')
    registerDialogIpc()
  })

  const show = (payload: unknown): Promise<unknown> =>
    mocks.handle.mock.calls
      .filter(([name]) => name === 'shell:show-item-in-folder')
      .at(-1)![1](fakeEvent, payload)

  it('avdHome 内放行；avdHome 外拒绝', async () => {
    await show({ path: '/userdata/avd-home/x.ini' })
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/userdata/avd-home/x.ini')

    mocks.showItemInFolder.mockClear()
    await expectShellReject(() => show({ path: '/etc/passwd' }))
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()
  })

  it('`..` 穿越被归一化后拒绝（review P1 主场景）', async () => {
    await expectShellReject(() => show({ path: '/userdata/avd-home/a/../../secrets.txt' }))
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()
  })

  it('NUL 字节拒绝', async () => {
    await expectShellReject(() => show({ path: '/userdata/avd-home/a\0b' }))
  })
})

/** rejects.toThrow 修饰符在本文件的 electron mock 组合下不稳定——显式 try/catch 断言 */
async function expectShellReject(run: () => Promise<unknown>): Promise<void> {
  let threw = false
  try {
    await run()
  } catch (error) {
    threw = true
    expect(error instanceof Error ? error.message : String(error)).toMatch(/shellPathRejected/)
  }
  expect(threw).toBe(true)
}
