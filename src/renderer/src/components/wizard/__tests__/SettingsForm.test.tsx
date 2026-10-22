import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceAdvancedSettings, WizardCapabilities } from '@shared/types'
import SettingsForm from '../SettingsForm'
import { WIZARD_COPY } from '@shared/i18n/wizard'

const copy = WIZARD_COPY['zh-CN']

afterEach(cleanup)

const camera = (mode: DeviceAdvancedSettings['frontCamera']['mode'] = 'emulated'): {
  mode: DeviceAdvancedSettings['frontCamera']['mode']
  deviceId: string | null
} => ({ mode, deviceId: null })

const value: DeviceAdvancedSettings = {
  skinRef: null,
  frontCamera: camera(),
  rearCamera: camera(),
  networkSpeed: null,
  networkLatency: null,
  orientation: null,
  bootMode: 'cold',
  internalStorageMiB: 2048,
  cpuCores: 2,
  graphics: 'host',
  ramMiB: 2048,
  vmHeapMiB: 256,
  preferredAbi: 'optimal'
}

const capabilities = (
  cameraSnapshot?: WizardCapabilities['cameraSnapshot']
): WizardCapabilities => ({
  capabilityContextId: 'ctx',
  emulatorVersion: '36.1.9',
  defaults: value,
  fields: {},
  quickBootAvailable: false,
  quickBootDisabledReason: 'not yet',
  webcamDeviceIds: [],
  cameraSnapshot,
  recommendedSkin: null,
  skinIds: []
})

const setup = (caps: WizardCapabilities): { onCameraAction: ReturnType<typeof vi.fn> } => {
  const onCameraAction = vi.fn(async () => undefined)
  render(
    <SettingsForm
      capabilities={caps}
      value={value}
      errors={{}}
      onChange={vi.fn()}
      skins={[]}
      onImportSkin={vi.fn(async () => undefined)}
      onDownloadSkin={vi.fn(async () => undefined)}
      skinDownloading={null}
      onCameraAction={onCameraAction}
    />
  )
  return { onCameraAction }
}

describe('摄像头设置入口的平台条件（plan 2026-10-22-windows-emulator-env 设计 5）', () => {
  const emptySnapshot = { permission: 'granted' as const, devices: [], error: null }

  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = { platform: 'win32' }
  })

  it('win32 空列表：按钮可见（win32 恒 granted，入口改由空列表驱动）；点击走 settings 动作', () => {
    const { onCameraAction } = setup(capabilities(emptySnapshot))
    const button = screen.getByRole('button', { name: copy.openCameraSettings })
    fireEvent.click(button)
    expect(onCameraAction).toHaveBeenCalledWith('settings')
  })

  it('win32 有设备：按钮不渲染（空列表才指向隐私设置）', () => {
    setup(
      capabilities({
        permission: 'granted',
        devices: [{ id: 'webcam0', deviceLabel: 'FaceTime' }],
        error: null
      })
    )
    expect(screen.queryByRole('button', { name: copy.openCameraSettings })).toBeNull()
  })

  it('mac（darwin）：空 granted 快照不渲染——维持 denied/restricted 才显示的现状', () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
    setup(capabilities(emptySnapshot))
    expect(screen.queryByRole('button', { name: copy.openCameraSettings })).toBeNull()
  })
})
