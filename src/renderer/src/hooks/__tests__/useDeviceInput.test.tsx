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
  changeGeneration: () => void
}

const setup = (observeGeneration = false): InputHarness => {
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
  let generationListener: (() => void) | undefined
  const onGenerationChange = (listener: () => void): (() => void) => {
    generationListener = listener
    return () => {
      generationListener = undefined
    }
  }
  const { rerender } = renderHook(
    ({ enabled }) =>
      useDeviceInput({
        canvasContainerRef,
        inputProxyRef,
        screenRef,
        layoutRef,
        enabled,
        ...(observeGeneration ? { onGenerationChange } : {}),
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
  return {
    proxy,
    pointer,
    flushFrames,
    setEnabled: (enabled: boolean) => rerender({ enabled }),
    changeGeneration: () => {
      act(() => {
        screenRef.current.envelope.generation += 1
        generationListener?.()
      })
    }
  }
}

it('自动重同步释放新代次并清旧 Move/Up，恢复后只接受新 Down', () => {
  const { pointer, flushFrames, changeGeneration } = setup(true)
  pointer('pointerdown')
  pointer('pointermove')
  expect(frames.size).toBe(1)
  changeGeneration()
  expect(frames.size).toBe(0)
  flushFrames()
  pointer('pointermove')
  pointer('pointerup')
  expect(
    input.mock.calls.map(([request]) =>
      request.input.kind === 'touch' ? request.input.action : request.input.kind
    )
  ).toEqual(['down', 'release-all'])
  expect(input.mock.calls[1][0].generation).toBe(2)
  pointer('pointerdown')
  pointer('pointerup')
  expect(
    input.mock.calls
      .slice(2)
      .map(([request]) =>
        request.input.kind === 'touch' ? request.input.action : request.input.kind
      )
  ).toEqual(['down', 'up'])
})

it('自动重同步清旧按键与跨代次 IME，新按键和新组合仍可发送', () => {
  const { proxy, changeGeneration } = setup(true)
  fireEvent.keyDown(proxy, { key: 'Enter' })
  fireEvent.compositionStart(proxy)
  changeGeneration()
  fireEvent.keyUp(proxy, { key: 'Enter' })
  fireEvent.compositionEnd(proxy, { data: '旧组合' })
  expect(input.mock.calls.map(([request]) => request.input.kind)).toEqual([
    'keycode',
    'release-all'
  ])
  fireEvent.keyDown(proxy, { key: 'Enter' })
  fireEvent.keyUp(proxy, { key: 'Enter' })
  fireEvent.compositionStart(proxy)
  fireEvent.compositionEnd(proxy, { data: '新组合' })
  expect(input.mock.calls.slice(2).map(([request]) => request.input)).toEqual([
    { kind: 'keycode', key: 'enter', down: true },
    { kind: 'keycode', key: 'enter', down: false },
    { kind: 'text', text: '新组合', ime: true, source: 'composition' }
  ])
})

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

it.each(['key', 'pointer'])('已有 %s 按下在禁用时释放，恢复松开不重复发送', (kind) => {
  const { proxy, pointer, setEnabled } = setup()
  if (kind === 'key') fireEvent.keyDown(proxy, { key: 'Enter' })
  else pointer('pointerdown')
  setEnabled(false)
  expect(input.mock.calls.map(([request]) => request.input.kind)).toEqual([
    kind === 'key' ? 'keycode' : 'touch',
    'release-all'
  ])
  setEnabled(true)
  fireEvent.keyUp(proxy, { key: 'Enter' })
  pointer('pointerup')
  expect(input).toHaveBeenCalledTimes(2)
})

it('代次变化后不把旧手势释放发给新代次，恢复后新操作仍可用', () => {
  const { proxy, setEnabled, changeGeneration } = setup()
  fireEvent.keyDown(proxy, { key: 'Enter' })
  changeGeneration()
  setEnabled(false)
  expect(input).toHaveBeenCalledOnce()
  expect(input.mock.calls[0][0].generation).toBe(1)
  setEnabled(true)
  fireEvent.keyUp(proxy, { key: 'Enter' })
  expect(input).toHaveBeenCalledOnce()
  fireEvent.keyDown(proxy, { key: 'Enter' })
  expect(input.mock.calls[1][0].generation).toBe(2)
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
  ).toEqual(['down', 'release-all'])
  pointer('pointerdown')
  pointer('pointerup')
  expect(
    input.mock.calls.map(([request]) =>
      request.input.kind === 'touch' ? request.input.action : request.input.kind
    )
  ).toEqual(['down', 'release-all', 'down', 'up'])
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
    { kind: 'text', text: '新输入', ime: true, source: 'composition' }
  ])
})
