import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Device, DeviceSkinPresentation } from '@shared/types'
import DeviceCanvas from '../DeviceCanvas'

vi.mock('../../hooks/useDeviceInput', () => ({ useDeviceInput: () => {} }))
vi.mock('../../hooks/useDeviceScreen', () => ({
  useDeviceScreen: () => ({
    canvasRef: { current: null },
    status: 'ready',
    format: { width: 1080, height: 2400 },
    error: null,
    onGenerationChange: () => () => {},
    screenRef: { current: { envelope: null } },
    retry: () => {},
    paintsRef: { current: 0 }
  })
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

it('真实皮肤前景在视频上方，透传输入；通用外框没有该遮罩', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(): void {
        this.callback([{ contentRect: { width: 600, height: 800 } }])
      }
      disconnect(): void {
        this.callback = () => undefined
      }
    }
  )
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1080
      onload?: () => void
      set src(_url: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
  )
  const skin: DeviceSkinPresentation = {
    name: 'pixel_7',
    landscape: null,
    portrait: {
      frameWidth: 1200,
      frameHeight: 2541,
      screenX: 59,
      screenY: 58,
      screenWidth: 1080,
      screenHeight: 2400,
      rotation: 0,
      foregroundMask: 'mask.webp',
      backgrounds: []
    },
    images: [{ file: 'mask.webp', url: 'data:image/webp;base64,fixture' }]
  }
  ;(window as { api?: unknown }).api = { sdk: { deviceSkinPresentation: vi.fn(async () => skin) } }
  const device = {
    id: 'skin-test',
    name: 'Pixel 7',
    status: 'running',
    advancedSettings: { skinRef: 'downloaded:test' }
  } as Device
  const { container, rerender } = render(<DeviceCanvas device={device} onStop={async () => {}} />)
  await screen.findByLabelText('Pixel 7 画面')
  const mask = await waitFor(() => {
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    return image!
  })
  const canvas = container.querySelector('canvas')!
  expect(mask.parentElement).toBe(canvas.parentElement)
  expect(mask.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  expect(getComputedStyle(mask).zIndex).toBe('1')
  expect(getComputedStyle(mask).pointerEvents).toBe('none')
  expect(mask.style.transform).toBe('none')
  rerender(
    <DeviceCanvas
      device={{ ...device, advancedSettings: { ...device.advancedSettings!, skinRef: null } }}
      onStop={async () => {}}
    />
  )
  await waitFor(() => expect(container.querySelector('img')).toBeNull())
})
