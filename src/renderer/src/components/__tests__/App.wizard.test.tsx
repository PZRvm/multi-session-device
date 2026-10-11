import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { useDeviceStore } from '../../stores/deviceStore'
import { MAIN_COPY } from '@shared/i18n'
import { networkApiMock } from './networkApiMock'
const copy = MAIN_COPY['zh-CN']

vi.mock('../DeviceCanvas', () => ({ default: () => null }))
vi.mock('../ResizeHandle', () => ({ default: () => null }))
vi.mock('../DeviceListPane', () => ({
  default: ({ onEdit }: { onEdit: (id: string) => void }) => (
    <div>
      <button onClick={() => onEdit('target')}>test-edit</button>
      <button onClick={() => onEdit('other')}>test-other-edit</button>
    </div>
  )
}))

const open = vi.fn()
const openEditor = vi.fn()
const openSettings = vi.fn()
const dialog = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useDeviceStore.setState({
    devices: [],
    selectedId: null,
    revision: -1,
    loaded: false,
    loadError: null,
    storeHealth: { state: 'ok', issues: [] },
    reconciliation: {
      signature: null,
      unavailableCount: 0,
      orphanCount: 0,
      storeState: 'ok',
      pendingNotification: false
    }
  })
  ;(window as unknown as { api: unknown }).api = {
    wizard: { open, openEditor },
    settings: { open: openSettings },
    dialog: { show: dialog },
    logcat: {
      isWindowOpen: vi.fn(async () => false),
      openWindow: vi.fn(async () => undefined),
      onDockBack: () => () => {},
      setDockState: vi.fn(async () => undefined)
    },
    devices: {
      list: vi.fn(async () => ({
        revision: 1,
        devices: [],
        storeHealth: { state: 'ok', issues: [] },
        reconciliation: useDeviceStore.getState().reconciliation
      })),
      onChanged: () => () => {},
      onRuntimeError: () => () => {}
    },
    network: networkApiMock()
  }
  dialog.mockResolvedValue({ response: 0 })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('打开独立窗口失败提示', () => {
  it.each(['create', 'edit', 'settings'] as const)(
    '%s 连点与重复故障只有一次提示，关闭提示后允许重试',
    async (kind) => {
      let reject!: (error: Error) => void
      let closeAlert!: () => void
      const request = kind === 'create' ? open : kind === 'edit' ? openEditor : openSettings
      request
        .mockReturnValueOnce(
          new Promise((_, failed) => {
            reject = failed
          })
        )
        .mockResolvedValue(undefined)
      dialog.mockReturnValueOnce(
        new Promise((done) => {
          closeAlert = () => done({ response: 0 })
        })
      )
      await act(async () => {
        render(<App />)
      })
      const button =
        kind === 'create'
          ? screen.getAllByRole('button', { name: copy.createDevice })[0]
          : screen.getByRole('button', { name: kind === 'edit' ? 'test-edit' : copy.settings })
      fireEvent.click(button)
      fireEvent.click(button)
      expect(request).toHaveBeenCalledTimes(1)
      await act(async () => {
        reject(new Error('load failed'))
      })
      expect(dialog).toHaveBeenCalledTimes(1)
      expect(dialog.mock.calls[0][0].title).toBe(
        kind === 'create'
          ? copy.openWizardFailed
          : kind === 'edit'
            ? copy.openEditorFailed
            : copy.openSettingsFailed
      )
      fireEvent.click(button)
      expect(request).toHaveBeenCalledTimes(1)
      await act(async () => {
        closeAlert()
      })
      await act(async () => {
        fireEvent.click(button)
      })
      expect(request).toHaveBeenCalledTimes(2)
      expect(dialog).toHaveBeenCalledTimes(1)
    }
  )

  it('加载取消正常返回，无错误提示且可以重开', async () => {
    open.mockResolvedValue(undefined)
    await act(async () => {
      render(<App />)
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: copy.createDevice })[0])
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: copy.createDevice })[0])
    })
    expect(open).toHaveBeenCalledTimes(2)
    expect(dialog).not.toHaveBeenCalled()
  })

  it('不同编辑目标的冲突仍提示，不被同上下文连点保护吞掉', async () => {
    let ready!: () => void
    openEditor
      .mockReturnValueOnce(
        new Promise<void>((done) => {
          ready = done
        })
      )
      .mockRejectedValueOnce(new Error('请先关闭原窗口'))
    await act(async () => {
      render(<App />)
    })
    fireEvent.click(screen.getByRole('button', { name: 'test-edit' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'test-other-edit' }))
    })
    expect(openEditor.mock.calls).toEqual([['target'], ['other']])
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(dialog.mock.calls[0][0].message).toContain('请先关闭原窗口')
    await act(async () => {
      ready()
    })
  })
})
