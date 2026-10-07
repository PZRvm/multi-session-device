import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  type ScrcpyControlMessageWriter
} from '@yume-chan/scrcpy'
import type { Device, ScreenInputRequest } from '@shared/types'
import { injectInput, type InjectContext } from '../../../../main/scrcpy/control'
import DeviceCanvas from '../DeviceCanvas'

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
afterEach(() => {
  cleanup()
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
          /* 键盘测试不需要布局 */
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
    const proxy = screen.getByLabelText('Pixel test 输入')
    fireEvent.keyDown(proxy, { key: 'ArrowDown' })
    expect(heldByDevice.has(AndroidKeyCode.ArrowDown)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '旋转屏幕' }))
    await waitFor(() => expect(lockRotation).toHaveBeenCalledOnce())
    try {
      expect(heldByDevice.size).toBe(0)
      fireEvent.keyDown(proxy, { key: 'Enter' })
      fireEvent.keyUp(proxy, { key: 'ArrowDown' })
      expect(input).toHaveBeenCalledTimes(2)
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
      expect(input).toHaveBeenCalledTimes(4)
      expect(heldByDevice.size).toBe(0)
    } finally {
      await act(async () => finish())
    }
  }
)
