import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  },
  sourceBucket: 'app-owned'
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
/** devices:changed 推送捕获（beforeEach 重置；补漏分支测试用） */
let pushSnapshot: ((snap: DeviceSnapshot) => void) | null = null
const reconciliationReport = vi.fn(async () => report)
const acknowledgeReconciliation = vi.fn(async () => {})
const reportWindowOpen = vi.fn(async () => {})

beforeEach(() => {
  vi.clearAllMocks()
  pushSnapshot = null
  useDeviceStore.setState({
    devices: [],
    selectedId: null,
    revision: -1,
    loaded: false,
    loadError: null,
    // review P3-6：zustand 单例跨用例泄漏，显式复位视图桶初值
    sourceBucket: 'app-owned',
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
      onChanged: (cb: (snap: DeviceSnapshot) => void): (() => void) => {
        pushSnapshot = cb
        return () => {}
      },
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

  it('另一来源桶的异常不弹原生通知——静默登记 seen 并代为 ack（用户 2026-10-12 复核续）', async () => {
    const hiddenSnapshot: DeviceSnapshot = {
      ...snapshot,
      devices: [{ ...device, imageSourceOrigin: 'shared-studio' }],
      sourceBucket: 'app-owned'
    }
    ;(
      (window as unknown as { api: { devices: { list: unknown } } }).api.devices.list as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue(hiddenSnapshot)
    render(<App />)
    await waitFor(() => expect(useDeviceStore.getState().loaded).toBe(true))
    await waitFor(() =>
      expect(acknowledgeReconciliation).toHaveBeenCalledWith('sig-anomaly-1')
    )
    expect(dialog).not.toHaveBeenCalled()
    expect(reportWindowOpen).not.toHaveBeenCalled()
  })

  it('补漏分支守视图口径（review P3-5）：弹窗在途到达的隐藏侧新签名——静默 ack 不开报告窗', async () => {
    // 弹窗悬挂（不立即回复），期间推一个"异常全在另一桶"的新签名
    let releaseDialog!: (value: { response: number; checkboxChecked: boolean }) => void
    dialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDialog = resolve
        })
    )
    render(<App />)
    await waitFor(() => expect(dialog).toHaveBeenCalled())
    const hiddenSnapshot: DeviceSnapshot = {
      ...snapshot,
      revision: 2,
      devices: [{ ...device, imageSourceOrigin: 'shared-studio' }],
      sourceBucket: 'app-owned',
      reconciliation: {
        ...snapshot.reconciliation,
        signature: 'sig-hidden-2',
        unavailableCount: 1
      }
    }
    act(() => {
      pushSnapshot?.(hiddenSnapshot)
    })
    releaseDialog({ response: 1, checkboxChecked: false })
    await waitFor(() =>
      expect(acknowledgeReconciliation).toHaveBeenCalledWith('sig-hidden-2')
    )
    // 弹窗一次、报告窗零开（首签 response=1 不开；补漏签名隐藏侧静默）
    expect(dialog).toHaveBeenCalledTimes(1)
    expect(reportWindowOpen).not.toHaveBeenCalled()
  })

  it('scanError 非空不适用视图静默（review P3-4）：无可见异常也照常弹通知', async () => {
    const scanFailed: DeviceSnapshot = {
      ...snapshot,
      reconciliation: { ...snapshot.reconciliation, signature: 'sig-scan', scanError: '扫描中断' }
    }
    ;(
      (window as unknown as { api: { devices: { list: unknown } } }).api.devices.list as ReturnType<
        typeof vi.fn
      >
    ).mockResolvedValue(scanFailed)
    render(<App />)
    // 断言核心：扫描失败未被判为"隐藏侧"而静默——通知照常弹出
    await waitFor(() => expect(dialog).toHaveBeenCalled())
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
