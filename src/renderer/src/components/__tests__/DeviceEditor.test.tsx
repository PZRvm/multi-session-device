import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type {
  DeviceAdvancedSettings,
  DeviceEditSnapshot,
  DeviceSnapshot,
  UpdateDeviceInput,
  WizardCapabilities
} from '@shared/types'
import DeviceEditor from '../DeviceEditor'

afterEach(cleanup)
afterEach(() => {
  delete (window as { api?: unknown }).api
})

const DEVICE_ID = '018f1c2d-aaaa-4000-8000-000000000001'

const settings = (overrides: Partial<DeviceAdvancedSettings> = {}): DeviceAdvancedSettings => ({
  skinRef: null,
  frontCamera: { mode: 'emulated', deviceId: null },
  rearCamera: { mode: 'emulated', deviceId: null },
  networkSpeed: null,
  networkLatency: null,
  orientation: null,
  bootMode: 'cold',
  internalStorageMiB: 6144,
  cpuCores: 4,
  graphics: 'auto',
  ramMiB: 2048,
  vmHeapMiB: 256,
  preferredAbi: 'optimal',
  ...overrides
})

const capabilities = (): WizardCapabilities => ({
  capabilityContextId: 'pixel_8|pkg|36.1.9|edit',
  emulatorVersion: '36.1.9',
  defaults: settings(),
  fields: {
    skinRef: { disabledReason: null, min: null, max: null, step: null },
    frontCamera: { disabledReason: null, min: null, max: null, step: null },
    rearCamera: { disabledReason: null, min: null, max: null, step: null },
    networkSpeed: { disabledReason: null, min: null, max: null, step: null },
    networkLatency: { disabledReason: null, min: null, max: null, step: null },
    orientation: { disabledReason: null, min: null, max: null, step: null },
    bootMode: { disabledReason: 'Quick 门槛未过', min: null, max: null, step: null },
    internalStorageMiB: { disabledReason: null, min: 2048, max: 65536, step: 1 },
    cpuCores: { disabledReason: null, min: 1, max: 8, step: 1 },
    graphics: { disabledReason: null, min: null, max: null, step: null },
    ramMiB: { disabledReason: null, min: 2048, max: 32768, step: 1 },
    vmHeapMiB: { disabledReason: null, min: 64, max: 1024, step: 1 },
    preferredAbi: { disabledReason: '跨架构二期', min: null, max: null, step: null }
  },
  quickBootAvailable: false,
  quickBootDisabledReason: 'Quick 门槛未过',
  webcamDeviceIds: [],
  skinIds: []
})

const snapshot = (overrides: Partial<DeviceEditSnapshot> = {}): DeviceEditSnapshot => ({
  deviceId: DEVICE_ID,
  identity: {
    name: '编辑机',
    profileId: 'pixel_8',
    profileLabel: 'Pixel 8',
    imagePackageName: 'system-images;android-36;google_apis;arm64-v8a',
    apiDisplay: '36',
    formFactor: 'phone'
  },
  settings: settings(),
  fieldNotes: {},
  internalStorage: { valueMiB: 6144, note: '已有模拟器不支持修改内部存储，容量保持原配置' },
  capabilities: capabilities(),
  saveBlockedReason: null,
  fingerprint: 'fp-1',
  ...overrides
})

/** onChanged 推送的最小快照（编辑页只消费 devices/storeHealth） */
const pushOf = (status: string, overrides: Partial<DeviceSnapshot> = {}): DeviceSnapshot =>
  ({
    revision: 1,
    devices: [
      {
        id: DEVICE_ID,
        name: '编辑机',
        profileId: 'pixel_8',
        profileLabel: 'Pixel 8',
        imagePackageName: 'system-images;android-36;google_apis;arm64-v8a',
        apiDisplay: '36',
        formFactor: 'phone',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        createdAt: 0,
        status
      }
    ],
    storeHealth: { state: 'ok', issues: [] },
    reconciliation: {
      signature: null,
      unavailableCount: 0,
      orphanCount: 0,
      storeState: 'ok',
      pendingNotification: false
    },
    ...overrides
  }) as DeviceSnapshot

interface EditorHarness {
  load: Mock<(deviceId: string) => Promise<DeviceEditSnapshot>>
  save: Mock<(input: UpdateDeviceInput) => Promise<void>>
  closeWizard: Mock<() => Promise<void>>
  push: (snapshot: DeviceSnapshot) => void
}

const mountEditor = (snap: DeviceEditSnapshot): EditorHarness => {
  const load = vi.fn(async () => snap)
  const save = vi.fn(async () => undefined)
  const closeWizard = vi.fn(async () => undefined)
  let pushListener: ((snapshot: DeviceSnapshot) => void) | null = null
  ;(window as { api?: unknown }).api = {
    wizard: { close: closeWizard },
    devices: {
      onChanged: (listener: (snapshot: DeviceSnapshot) => void): (() => void) => {
        pushListener = listener
        return () => {
          pushListener = null
        }
      }
    }
  }
  render(
    <DeviceEditor deviceId={DEVICE_ID} onCancel={closeWizard} onLoadSnapshot={load} onSave={save} />
  )
  return {
    load,
    save,
    closeWizard,
    push: (payload) => act(() => pushListener?.(payload))
  }
}

describe('DeviceEditor（编辑页）', () => {
  it('只有明确勾选恢复默认挖孔才提交恢复请求，未知 legacy 也可使用', async () => {
    const harness = mountEditor(snapshot({ settings: null }))
    const checkbox = await screen.findByLabelText(/恢复安卓默认挖孔/)
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(harness.save).toHaveBeenCalledWith({
        id: DEVICE_ID,
        fingerprint: 'fp-1',
        resetDisplayCutout: true
      })
    )
  })
  it('回填名称与设置；机型/API 只读展示；内部存储只读', async () => {
    mountEditor(snapshot())
    const nameInput = (await screen.findByLabelText('设备名称')) as HTMLInputElement
    expect(nameInput.value).toBe('编辑机')
    expect(await screen.findByText(/Pixel 8 · API 36/)).toBeTruthy()
    expect(screen.getByText(/内部存储 6144 MiB/)).toBeTruthy()
    const storage = screen.getByLabelText('userdata 容量') as HTMLInputElement
    expect(storage.disabled).toBe(true)
    expect(screen.getByText('已有模拟器不支持修改内部存储，容量保持原配置。')).toBeTruthy()
    // 无改动：保存禁用
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('改 RAM 后保存：载荷只带差异字段，不含存储/ABI/名称', async () => {
    const harness = mountEditor(snapshot())
    const ram = (await screen.findByLabelText(/内存（整机 RAM）/)) as HTMLInputElement
    fireEvent.change(ram, { target: { value: '4096' } })
    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    await waitFor(() => expect(saveButton.disabled).toBe(false))
    fireEvent.click(saveButton)
    await waitFor(() => expect(harness.save).toHaveBeenCalledTimes(1))
    const input = harness.save.mock.calls[0]![0]
    expect(input.fingerprint).toBe('fp-1')
    expect(input.name).toBeUndefined()
    expect(input.advancedSettings).toEqual({ ramMiB: 4096 })
    await waitFor(() => expect(harness.closeWizard).toHaveBeenCalled())
  })

  it('改名并调 heap：名称与差异同载荷提交', async () => {
    const harness = mountEditor(snapshot())
    fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '新名字' } })
    const heap = (await screen.findByLabelText(/VM heap/)) as HTMLInputElement
    fireEvent.change(heap, { target: { value: '512' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(harness.save).toHaveBeenCalled())
    const input = harness.save.mock.calls[0]![0]
    expect(input.name).toBe('新名字')
    expect(input.advancedSettings).toEqual({ vmHeapMiB: 512 })
  })

  it('保存失败：错误留在窗内，采用值与其他草稿保留可重试', async () => {
    const save = vi.fn(async () => {
      throw new Error('指纹失效，请重新打开')
    })
    const closeWizard = vi.fn(async () => undefined)
    ;(window as { api?: unknown }).api = {
      wizard: { close: closeWizard },
      devices: { onChanged: (): (() => void) => () => undefined }
    }
    render(
      <DeviceEditor
        deviceId={DEVICE_ID}
        onCancel={closeWizard}
        onLoadSnapshot={vi.fn(async () =>
          snapshot({
            configMismatches: [
              { field: 'vmHeapMiB', actualLabel: '228 MiB', actualSettings: { vmHeapMiB: 228 } }
            ]
          })
        )}
        onSave={save}
      />
    )
    fireEvent.change(await screen.findByLabelText(/内存（整机 RAM）/), {
      target: { value: '4096' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'VM heap：采用配置值' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/指纹失效/)).toBeTruthy()
    expect((screen.getByLabelText(/内存（整机 RAM）/) as HTMLInputElement).value).toBe('4096')
    expect((screen.getByRole('spinbutton', { name: /^VM heap/ }) as HTMLInputElement).value).toBe(
      '228'
    )
    expect(closeWizard).not.toHaveBeenCalled()
  })

  it('运行态推送：保存禁用并提示先停止；不重置草稿', async () => {
    const harness = mountEditor(snapshot())
    const ram = (await screen.findByLabelText(/内存（整机 RAM）/)) as HTMLInputElement
    fireEvent.change(ram, { target: { value: '4096' } })
    harness.push(pushOf('running'))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(
        true
      )
    )
    expect(screen.getByText('请先停止模拟器后再保存')).toBeTruthy()
    expect((screen.getByLabelText(/内存（整机 RAM）/) as HTMLInputElement).value).toBe('4096')
    // 回到停止态：恢复可保存
    harness.push(pushOf('stopped'))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(
        false
      )
    )
  })

  it('设备被删推送：保存禁用并提示', async () => {
    const harness = mountEditor(snapshot())
    await screen.findByLabelText('设备名称')
    harness.push({ ...pushOf('stopped'), devices: [] })
    expect(await screen.findByText('设备已被删除，无法保存')).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('运行中初载后停止：解除运行阻断，草稿保持且无需重开', async () => {
    const harness = mountEditor(snapshot({ status: 'running' }))
    fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '新名' } })
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    harness.push(pushOf('stopped'))
    await waitFor(() => expect(save.disabled).toBe(false))
    expect((screen.getByLabelText('设备名称') as HTMLInputElement).value).toBe('新名')
  })

  it('停止不能撤销文件冻结；旧值越界不阻止单独改名', async () => {
    const caps = capabilities()
    caps.fields.ramMiB.min = 2560
    const harness = mountEditor(
      snapshot({ capabilities: caps, saveBlockedReason: '文件冻结', status: 'running' })
    )
    fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '新名' } })
    harness.push(pushOf('stopped'))
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('文件冻结')).toBeTruthy()
  })

  it('未知 legacy 不显示默认附加表单，只改名仍可保存', async () => {
    const harness = mountEditor(
      snapshot({ settings: null, settingsBlockedReason: '旧设置未知，保持原配置' })
    )
    fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '新名' } })
    expect(screen.queryByLabelText(/内存（整机 RAM）/)).toBeNull()
    expect(screen.getByText('旧设置未知，保持原配置')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(harness.save).toHaveBeenCalledWith({
        id: DEVICE_ID,
        fingerprint: 'fp-1',
        name: '新名'
      })
    )
  })

  it('旧 RAM/heap/存储越界，仅改名仍可保存', async () => {
    const harness = mountEditor(
      snapshot({ settings: settings({ ramMiB: 512, vmHeapMiB: 2048, internalStorageMiB: 999999 }) })
    )
    fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '新名' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(harness.save).toHaveBeenCalled())
  })

  it('快照自带阻断原因（库冻结）：保存禁用并展示原因', async () => {
    mountEditor(
      snapshot({
        saveBlockedReason: '元数据写入已冻结（外部修改），暂不能保存配置'
      })
    )
    expect(await screen.findByText(/元数据写入已冻结/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('存在差异时未改表单也能保存，默认提交表单值，仅同步可写字段', async () => {
    const harness = mountEditor(
      snapshot({
        configMismatches: [
          { field: 'vmHeapMiB', actualLabel: '228 MiB', actualSettings: { vmHeapMiB: 228 } }
        ]
      })
    )
    await screen.findByRole('button', { name: 'VM heap：采用配置值' })
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() =>
      expect(harness.save).toHaveBeenCalledWith({
        id: DEVICE_ID,
        fingerprint: 'fp-1',
        advancedSettings: { vmHeapMiB: 256 }
      })
    )
  })

  it('逐项采用只更新该输入，其他草稿保留，混合选择一起保存', async () => {
    const harness = mountEditor(
      snapshot({
        configMismatches: [
          { field: 'vmHeapMiB', actualLabel: '228 MiB', actualSettings: { vmHeapMiB: 228 } },
          { field: 'ramMiB', actualLabel: '4096 MiB', actualSettings: { ramMiB: 4096 } }
        ]
      })
    )
    fireEvent.change(await screen.findByLabelText('设备名称'), { target: { value: '我的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'VM heap：采用配置值' }))
    expect((screen.getByRole('spinbutton', { name: /^VM heap/ }) as HTMLInputElement).value).toBe(
      '228'
    )
    expect(
      (screen.getByRole('spinbutton', { name: /^内存（整机 RAM）/ }) as HTMLInputElement).value
    ).toBe('2048')
    expect(screen.getByText(/已采用配置值 228 MiB/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(harness.save).toHaveBeenCalledWith({
        id: DEVICE_ID,
        fingerprint: 'fp-1',
        name: '我的草稿',
        advancedSettings: { vmHeapMiB: 228, ramMiB: 2048 }
      })
    )
  })

  it('无法识别的文件值没有采用按钮；同步值不合法时禁止保存', async () => {
    mountEditor(
      snapshot({
        settings: settings({ vmHeapMiB: 2048 }),
        configMismatches: [{ field: 'vmHeapMiB', actualLabel: 'auto', actualSettings: null }]
      })
    )
    await screen.findByText(/原值无法识别，不能采用/)
    expect(screen.queryByRole('button', { name: /采用配置值/ })).toBeNull()
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('字段警告（外部 config 不一致）逐条展示', async () => {
    mountEditor(
      snapshot({
        fieldNotes: {
          ramMiB: { source: 'metadata', warning: 'config.ini 与应用记录不一致（hw.ramSize=4096）' }
        }
      })
    )
    expect(await screen.findByText(/内存（整机 RAM）：config\.ini 与应用记录不一致/)).toBeTruthy()
  })

  it('取消与 Esc 关窗走 onCancel', async () => {
    const onCancel = vi.fn()
    ;(window as { api?: unknown }).api = {
      wizard: { close: vi.fn(async () => undefined) },
      devices: { onChanged: (): (() => void) => () => undefined }
    }
    render(
      <DeviceEditor
        deviceId={DEVICE_ID}
        onCancel={onCancel}
        onLoadSnapshot={vi.fn(async () => snapshot())}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
