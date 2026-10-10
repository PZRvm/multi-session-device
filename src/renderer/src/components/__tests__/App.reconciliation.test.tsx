import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, DeviceSnapshot, ReconcileReport } from '@shared/types'
import App from '../../App'
import { useDeviceStore } from '../../stores/deviceStore'
import { MAIN_COPY, format } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

vi.mock('../../components/DeviceCanvas', () => ({ default: () => null }))
vi.mock('../../components/ResizeHandle', () => ({ default: () => null }))

const device: Device = {
  id: 'd1',
  name: 'Pixel test',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;google_apis;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  status: 'stopped',
  availability: {
    state: 'missing',
    issues: [
      {
        component: 'avd',
        code: 'ini-missing',
        message: '缺少 d1.ini（AVD 可能被外部删除）',
        severity: 'error'
      }
    ],
    checkedAt: 2
  }
}

const snapshot: DeviceSnapshot = {
  revision: 1,
  devices: [device],
  storeHealth: { state: 'ok', issues: [] },
  reconciliation: {
    signature: 'sig-anomaly-1',
    unavailableCount: 1,
    orphanCount: 0,
    storeState: 'ok',
    pendingNotification: true
  }
}

const report: ReconcileReport = {
  revision: 1,
  signature: 'sig-anomaly-1',
  checkedAt: 2,
  storeHealth: { state: 'ok', issues: [] },
  deviceIssues: [{ id: 'd1', name: 'Pixel test', availability: device.availability! }],
  orphanEntries: [],
  unrecognizedCount: 0,
  pendingIds: [],
  scanError: null,
  pendingNotification: true
}

const dialog = vi.fn(async () => ({ response: 0, checkboxChecked: false }))
const reconciliationReport = vi.fn(async () => report)
const acknowledgeReconciliation = vi.fn(async () => {})

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
    dialog: { show: dialog },
    wizard: { open: vi.fn(async () => true) },
    logcat: {
      isWindowOpen: vi.fn(async () => false),
      openWindow: vi.fn(async () => undefined),
      onDockBack: () => () => {},
      setDockState: vi.fn(async () => undefined)
    },
    devices: {
      list: vi.fn(async () => snapshot),
      reconcile: vi.fn(async () => ({ snapshot, report })),
      reconciliationReport,
      acknowledgeReconciliation,
      onChanged: () => () => {},
      onRuntimeError: () => () => {}
    }
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('App 对账汇总提示（plan 设计 5）', () => {
  it('首载异常：拉报告弹一次原生 dialog，成功展示后确认签名', async () => {
    render(<App />)
    await waitFor(() => expect(dialog).toHaveBeenCalled())
    const shown = dialog.mock.calls[0] as unknown as [{ title: string; detail: string }]
    expect(shown[0]).toMatchObject({ title: copy.reconcileSummaryTitle })
    expect(shown[0].detail).toContain('缺少 d1.ini')
    await waitFor(() => expect(acknowledgeReconciliation).toHaveBeenCalledWith('sig-anomaly-1'))
  })

  it('无待提示（pendingNotification=false）：不弹、不确认', async () => {
    const quiet: DeviceSnapshot = {
      ...snapshot,
      reconciliation: { ...snapshot.reconciliation, signature: null, pendingNotification: false }
    }
    ;(
      (window as unknown as { api: { devices: { list: unknown } } }).api.devices.list as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue(quiet)
    render(<App />)
    await waitFor(() => expect(useDeviceStore.getState().loaded).toBe(true))
    expect(dialog).not.toHaveBeenCalled()
    expect(acknowledgeReconciliation).not.toHaveBeenCalled()
  })

  it('列表常驻：异常设备在汇总条与健康原因行可见，重新检查可触发', async () => {
    render(<App />)
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(
      screen.getByText(
        new RegExp(
          format(copy.unavailableDevices, { count: 1, names: 'Pixel test', more: '' }).split(
            '，'
          )[0]
        )
      )
    ).toBeTruthy()
    expect(screen.getByText(`${copy.availMissing}：缺少 d1.ini（AVD 可能被外部删除）`)).toBeTruthy()
  })
})
