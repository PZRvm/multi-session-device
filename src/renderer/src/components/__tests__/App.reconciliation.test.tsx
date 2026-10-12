import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device, DeviceSnapshot, ReconcileReport } from '@shared/types'
import App from '../../App'
import { useDeviceStore } from '../../stores/deviceStore'
import { MAIN_COPY, format } from '@shared/i18n'
import { networkApiMock } from './networkApiMock'
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
const reportWindowOpen = vi.fn(async () => {})

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
    report: { openWindow: reportWindowOpen },
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
    },
    network: networkApiMock()
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('App 对账汇总提示（plan 设计 5）', () => {
  it('首载异常：摘要式 dialog（无长 detail、按钮 查看详情/知道了），确认签名后选「查看详情」开完整面板', async () => {
    render(<App />)
    await waitFor(() => expect(dialog).toHaveBeenCalled())
    const shown = dialog.mock.calls[0] as unknown as [
      { title: string; detail?: string; buttons: string[] }
    ]
    expect(shown[0]).toMatchObject({ title: copy.reconcileSummaryTitle })
    // 摘要式（plan 2026-10-12）：不携带长文本 detail，按钮常在屏内
    expect(shown[0].detail).toBeUndefined()
    expect(shown[0].buttons).toEqual([copy.reconcileSummaryView, copy.reconcileSummaryAck])
    await waitFor(() => expect(acknowledgeReconciliation).toHaveBeenCalledWith('sig-anomaly-1'))
    // response=0（查看详情，dialog mock 默认）→ 打开独立对账详情窗（子窗口方案）
    expect(reportWindowOpen).toHaveBeenCalledTimes(1)
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
