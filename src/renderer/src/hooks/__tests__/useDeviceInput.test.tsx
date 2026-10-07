import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScreenInputRequest } from '@shared/types'
import { useDeviceInput } from '../useDeviceInput'
import { computeLayout } from '../../screen/geometry'

const input = vi.fn<(request: ScreenInputRequest) => Promise<void>>(async () => {})
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
beforeEach(() => {
  vi.clearAllMocks()
  frames.clear()
  frameId = 0
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    })
  )
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      frames.delete(id)
    })
  )
  ;(window as { api?: unknown }).api = { screen: { input } }
})
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

interface InputHarness {
  proxy: HTMLInputElement
  pointer: (kind: string) => void
  flushFrames: () => void
  setEnabled: (enabled: boolean) => void
}

const setup = (): InputHarness => {
  const container = document.createElement('div')
  const proxy = document.createElement('input')
  container.append(proxy)
  document.body.append(container)
  const layout = computeLayout(600, 800, 1080, 2400)!
  const screenRef = {
    current: {
      envelope: { deviceId: 'd1', runId: 'r1', streamId: 's1', generation: 1, viewToken: 'vt' },
      width: 1080,
      height: 2400
    }
  }
  const canvasContainerRef = { current: container }
  const inputProxyRef = { current: proxy }
  const layoutRef = { current: layout }
  const onInputError = vi.fn()
  const { rerender } = renderHook(
    ({ enabled }) =>
      useDeviceInput({
        canvasContainerRef,
        inputProxyRef,
        screenRef,
        layoutRef,
        enabled,
        onInputError
      }),
    { initialProps: { enabled: true } }
  )
  const pointer = (kind: string): void => {
    const event = new MouseEvent(kind, {
      bubbles: true,
      button: 0,
      clientX: layout.offsetX + layout.width / 2,
      clientY: layout.offsetY + layout.height / 2
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    fireEvent(container, event)
  }
  const flushFrames = (): void => {
    act(() => {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(0)
    })
  }
  return { proxy, pointer, flushFrames, setEnabled: (enabled: boolean) => rerender({ enabled }) }
}

it('禁用期间的新触摸、按键与文本不发送，恢复后不补发，仍接受新操作', () => {
  const { proxy, pointer, setEnabled, flushFrames } = setup()
  setEnabled(false)
  pointer('pointerdown')
  pointer('pointermove')
  pointer('pointerup')
  fireEvent.keyDown(proxy, { key: 'Enter' })
  fireEvent.keyUp(proxy, { key: 'Enter' })
  fireEvent(proxy, new InputEvent('beforeinput', { inputType: 'insertText', data: '丢弃' }))
  fireEvent.compositionStart(proxy)
  fireEvent.compositionEnd(proxy, { data: '丢弃' })
  setEnabled(true)
  flushFrames()
  pointer('pointerup')
  fireEvent.keyUp(proxy, { key: 'Enter' })
  expect(input).not.toHaveBeenCalled()
  fireEvent.keyDown(proxy, { key: 'Enter' })
  fireEvent.keyUp(proxy, { key: 'Enter' })
  expect(input.mock.calls.map(([request]) => request.input)).toEqual([
    { kind: 'keycode', key: 'enter', down: true },
    { kind: 'keycode', key: 'enter', down: false }
  ])
})

it('暂停销毁等待 RAF 的移动，恢复后不会发送已取消手势的 Move', () => {
  const { pointer, setEnabled, flushFrames } = setup()
  pointer('pointerdown')
  pointer('pointermove')
  expect(frames.size).toBe(1)
  setEnabled(false)
  expect(frames.size).toBe(0)
  setEnabled(true)
  flushFrames()
  pointer('pointerup')
  expect(
    input.mock.calls.map(([request]) =>
      request.input.kind === 'touch' ? request.input.action : request.input.kind
    )
  ).toEqual(['down'])
  pointer('pointerdown')
  pointer('pointerup')
  expect(
    input.mock.calls.map(([request]) =>
      request.input.kind === 'touch' ? request.input.action : request.input.kind
    )
  ).toEqual(['down', 'down', 'up'])
})

it.each(['before', 'during'])('跨暂停的 IME 组合不在恢复后提交，新组合正常发送：%s', (start) => {
  const { proxy, setEnabled } = setup()
  if (start === 'before') fireEvent.compositionStart(proxy)
  setEnabled(false)
  if (start === 'during') fireEvent.compositionStart(proxy)
  setEnabled(true)
  fireEvent.compositionEnd(proxy, { data: '不应补发' })
  expect(input).not.toHaveBeenCalled()
  fireEvent.compositionStart(proxy)
  fireEvent.compositionEnd(proxy, { data: '新输入' })
  expect(input.mock.calls.map(([request]) => request.input)).toEqual([
    { kind: 'text', text: '新输入', ime: true }
  ])
})
