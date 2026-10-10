import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  type ScrcpyControlMessageWriter
} from '@yume-chan/scrcpy'
import type { Device, ScreenInputRequest } from '@shared/types'
import {
  injectInput,
  TEXT_MAX_BYTES,
  validateInputRequest,
  type InjectContext
} from '../../../../main/scrcpy/control'
import DeviceCanvas from '../DeviceCanvas'
import { MAIN_COPY, format } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

const mocks = vi.hoisted(() => ({
  screenRef: {
    current: {
      envelope: { deviceId: 'd1', runId: 'r1', streamId: 's1', generation: 1, viewToken: 'vt' },
      width: 1080,
      height: 2400
    }
  },
  onGenerationChange: () => () => {}
}))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: 'ready',
    format: { width: 1080, height: 2400 },
    error: null,
    screenRef: mocks.screenRef,
    onGenerationChange: mocks.onGenerationChange,
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 800,
    left: 0,
    top: 0,
    right: 600,
    bottom: 800
  } as DOMRect)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

it.each(['success', 'failure'])(
  '真实 Canvas 与输入 hook：按住键旋转，暂停前由控制层释放旧键，不依赖松键补发：%s',
  async (outcome) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {
          /* 初始布局由同步测量提供，观察者不再立即回调。 */
        }
        disconnect(): void {
          /* 无资源 */
        }
      }
    )
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const heldByDevice = new Set<AndroidKeyCode>()
    const injectKeyCode = vi.fn(
      async (message: { keyCode: AndroidKeyCode; action: AndroidKeyEventAction }) => {
        if (message.action === AndroidKeyEventAction.Down) heldByDevice.add(message.keyCode)
        else heldByDevice.delete(message.keyCode)
      }
    )
    const rotateDevice = vi.fn(async () => {})
    const lockRotation = vi.fn(async () => {
      await pending
      if (outcome === 'failure') throw new Error('锁定屏幕旋转失败：permission denied')
    })
    const context: InjectContext = {
      writer: { injectKeyCode, rotateDevice } as unknown as ScrcpyControlMessageWriter,
      width: 1080,
      height: 2400,
      pressedPointers: new Set(),
      pressedKeys: new Set(),
      clipboardPaste: vi.fn(),
      lockRotation
    }
    const input = vi.fn((request: ScreenInputRequest) => injectInput(request, context))
    ;(window as { api?: unknown }).api = { screen: { input } }
    render(
      <DeviceCanvas
        device={
          { id: 'd1', name: 'Pixel test', status: 'running', advancedSettings: null } as Device
        }
        onStop={async () => {}}
      />
    )
    const proxy = screen.getByLabelText(format(copy.inputAria, { name: 'Pixel test' }))
    fireEvent.keyDown(proxy, { key: 'ArrowDown' })
    expect(heldByDevice.has(AndroidKeyCode.ArrowDown)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: copy.rotate }))
    await waitFor(() => expect(lockRotation).toHaveBeenCalledOnce())
    try {
      expect(heldByDevice.size).toBe(0)
      fireEvent.keyDown(proxy, { key: 'Enter' })
      fireEvent.keyUp(proxy, { key: 'ArrowDown' })
      expect(input.mock.calls.map(([request]) => request.input.kind)).toEqual([
        'keycode',
        'rotate',
        'release-all'
      ])
      await act(async () => finish())
      fireEvent.keyUp(proxy, { key: 'ArrowDown' })
      expect(heldByDevice.size).toBe(0)
      expect(injectKeyCode.mock.calls.map(([message]) => message.action)).toEqual([
        AndroidKeyEventAction.Down,
        AndroidKeyEventAction.Up
      ])
      expect(rotateDevice).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0)
      if (outcome === 'failure')
        expect(screen.getByRole('alert').textContent).toContain('permission denied')
      fireEvent.keyDown(proxy, { key: 'Enter' })
      fireEvent.keyUp(proxy, { key: 'Enter' })
      expect(input).toHaveBeenCalledTimes(5)
      expect(heldByDevice.size).toBe(0)
    } finally {
      await act(async () => finish())
    }
  }
)

describe('外部纯文本粘贴', () => {
  let resize: (width: number, height: number) => void
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = (width, height) =>
            callback([{ contentRect: { width, height } } as ResizeObserverEntry], this)
        }
        observe(): void {
          /* 初测提供有效布局。 */
        }
        unobserve(): void {
          /* 无资源。 */
        }
        disconnect(): void {
          /* 无资源。 */
        }
      }
    )
  })

  type InputHandler = (request: ScreenInputRequest) => Promise<void>
  const mountPaste = (
    acceptedInput = vi.fn<InputHandler>(async () => {})
  ): { proxy: HTMLInputElement; input: Mock<InputHandler>; acceptedInput: Mock<InputHandler> } => {
    const input = vi.fn(async (request: ScreenInputRequest) => {
      const valid = validateInputRequest(request)
      if (!valid) throw new Error('输入参数非法')
      await acceptedInput(valid)
    })
    ;(window as { api?: unknown }).api = { screen: { input } }
    render(
      <DeviceCanvas
        device={
          { id: 'd1', name: 'Paste test', status: 'running', advancedSettings: null } as Device
        }
        onStop={async () => {}}
      />
    )
    return {
      proxy: screen.getByLabelText(
        format(copy.inputAria, { name: 'Paste test' })
      ) as HTMLInputElement,
      input,
      acceptedInput
    }
  }
  const paste = (
    proxy: HTMLElement,
    text: string
  ): { event: Event; getData: Mock<(type: string) => string> } => {
    const getData = vi.fn((type: string) => (type === 'text/plain' ? text : '<b>不要粘贴 HTML</b>'))
    const event = createEvent.paste(proxy, {
      clipboardData: { getData },
      bubbles: true,
      cancelable: true
    })
    fireEvent(proxy, event)
    return { event, getData }
  }

  it.each(['key', 'pointer'])('画布归零释放已有 %s，恢复后不补发暂停期间输入', (kind) => {
    const view = mountPaste()
    if (kind === 'key') fireEvent.keyDown(view.proxy, { key: 'Enter' })
    else {
      const event = createEvent.pointerDown(view.proxy.parentElement!, {
        button: 0,
        clientX: 300,
        clientY: 400,
        bubbles: true
      })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      fireEvent(view.proxy.parentElement!, event)
    }
    expect(view.input).toHaveBeenCalledOnce()
    act(() => resize(0, 0))
    expect(view.input.mock.calls.map(([request]) => request.input.kind)).toEqual([
      kind === 'key' ? 'keycode' : 'touch',
      'release-all'
    ])
    fireEvent.keyDown(view.proxy, { key: 'ArrowDown' })
    act(() => resize(600, 800))
    fireEvent.keyUp(view.proxy, { key: 'Enter' })
    fireEvent.keyUp(view.proxy, { key: 'ArrowDown' })
    expect(view.input).toHaveBeenCalledTimes(2)
  })

  it.each(['English text', '外部中文粘贴', '第一行\nsecond line 😀'])(
    '原生 paste 文本完整走剪贴板通道且只提交一次：%s',
    async (text) => {
      const view = mountPaste()
      fireEvent.keyDown(view.proxy, { key: 'v', metaKey: true })
      const { event, getData } = paste(view.proxy, text)
      fireEvent(
        view.proxy,
        new InputEvent('beforeinput', {
          inputType: 'insertFromPaste',
          data: text,
          bubbles: true,
          cancelable: true
        })
      )
      await waitFor(() => expect(view.acceptedInput).toHaveBeenCalledOnce())
      expect(event.defaultPrevented).toBe(true)
      expect(getData).toHaveBeenCalledExactlyOnceWith('text/plain')
      expect(view.input).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          deviceId: 'd1',
          viewToken: 'vt',
          input: { kind: 'text', text, ime: true }
        })
      )
      expect(view.proxy.value).toBe('')
    }
  )

  it('布局不可用时丢弃 paste，不读内容、不补发', () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({
      width: 0,
      height: 0
    } as DOMRect)
    const view = mountPaste()
    const { event, getData } = paste(view.proxy, '不能排队的粘贴')
    expect(event.defaultPrevented).toBe(true)
    expect(getData).not.toHaveBeenCalled()
    expect(view.input).not.toHaveBeenCalled()
    act(() => resize(600, 800))
    expect(view.input).not.toHaveBeenCalled()
    paste(view.proxy, '恢复后的新粘贴')
    expect(view.input).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ input: { kind: 'text', text: '恢复后的新粘贴', ime: true } })
    )
  })

  it('空内容、非文本与正在组合的 paste 不提交', () => {
    const view = mountPaste()
    expect(paste(view.proxy, '').event.defaultPrevented).toBe(true)
    fireEvent(view.proxy, createEvent.paste(view.proxy, { bubbles: true, cancelable: true }))
    fireEvent.compositionStart(view.proxy)
    paste(view.proxy, '组合中不混入')
    expect(view.input).not.toHaveBeenCalled()
  })

  it('普通打字与 IME 确认仍各提交一次', async () => {
    const view = mountPaste()
    fireEvent(
      view.proxy,
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'a',
        bubbles: true,
        cancelable: true
      })
    )
    fireEvent.compositionStart(view.proxy)
    fireEvent.compositionEnd(view.proxy, { data: '中文' })
    await waitFor(() => expect(view.acceptedInput).toHaveBeenCalledTimes(2))
    expect(view.input.mock.calls.map(([request]) => request.input)).toEqual([
      { kind: 'text', text: 'a', ime: false },
      { kind: 'text', text: '中文', ime: true }
    ])
    expect(view.input).toHaveBeenCalledTimes(2)
  })

  it('发送失败沿用画布错误提示，不留代理输入内容', async () => {
    const view = mountPaste(
      vi.fn(async () => {
        throw new Error('控制通道已关闭')
      })
    )
    paste(view.proxy, '失败粘贴')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('控制通道已关闭'))
    expect(view.proxy.value).toBe('')
  })

  it('沿用 main 的 4 KiB UTF-8 边界，超限不写设备', async () => {
    const view = mountPaste()
    const boundary = '中'.repeat(1365) + 'a'
    expect(new TextEncoder().encode(boundary).length).toBe(TEXT_MAX_BYTES)
    paste(view.proxy, boundary)
    await waitFor(() => expect(view.acceptedInput).toHaveBeenCalledOnce())
    paste(view.proxy, boundary + 'a')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('输入参数非法'))
    expect(view.acceptedInput).toHaveBeenCalledOnce()
  })
})
