import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReconciliationSummary, StoreHealth } from '@shared/types'
import DeviceHealthNotice from '../DeviceHealthNotice'
import { MAIN_COPY, format } from '@shared/i18n'
const copy = MAIN_COPY['zh-CN']

afterEach(cleanup)

const okStore: StoreHealth = { state: 'ok', issues: [] }
const okSummary: ReconciliationSummary = {
  signature: null,
  unavailableCount: 0,
  orphanCount: 0,
  storeState: 'ok',
  pendingNotification: false
}

const renderNotice = (
  summary: ReconciliationSummary,
  storeHealth: StoreHealth = okStore,
  affectedNames: string[] = [],
  unavailableCount: number = summary.unavailableCount
): { onRecheck: ReturnType<typeof vi.fn>; onViewDetail: ReturnType<typeof vi.fn> } => {
  const onRecheck = vi.fn()
  const onViewDetail = vi.fn()
  render(
    <DeviceHealthNotice
      summary={summary}
      storeHealth={storeHealth}
      unavailableCount={unavailableCount}
      affectedNames={affectedNames}
      rechecking={false}
      onRecheck={onRecheck}
      onViewDetail={onViewDetail}
    />
  )
  return { onRecheck, onViewDetail }
}

describe('DeviceHealthNotice', () => {
  it('无异常时不渲染', () => {
    renderNotice(okSummary)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('store error：显示读取失败文案与详情入口', () => {
    const { onViewDetail } = renderNotice(
      { ...okSummary, storeState: 'error', signature: 'sig' },
      { state: 'error', issues: [{ code: 'invalid-json', message: 'devices.json 不是合法 JSON' }] }
    )
    expect(screen.getByText(new RegExp(copy.errorState.split('（')[0]))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: copy.viewDetail }))
    expect(onViewDetail).toHaveBeenCalledTimes(1)
  })

  it('设备异常 + 孤立组：数量与设备名可见，重查回调触发', () => {
    const { onRecheck } = renderNotice(
      { ...okSummary, signature: 'sig-2', unavailableCount: 2, orphanCount: 3 },
      okStore,
      ['A 机', 'B 机', 'C 机', 'D 机']
    )
    expect(
      screen.getByText(
        new RegExp(
          format(copy.unavailableDevices, {
            count: 2,
            names: 'A 机、B 机、C 机',
            more: format(copy.moreSuffix, { count: 4 })
          })
        )
      )
    ).toBeTruthy()
    expect(
      screen.getByText(new RegExp(format(copy.orphanAvds, { count: 3 }).split('（')[0]))
    ).toBeTruthy()
    expect(screen.getByText(/不自动清理/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(copy.recheck) }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  it('重查进行中按钮禁用（忙碌态）', () => {
    render(
      <DeviceHealthNotice
        summary={{ ...okSummary, signature: 'sig', unavailableCount: 1 }}
        storeHealth={okStore}
        unavailableCount={1}
        affectedNames={['A 机']}
        rechecking={true}
        onRecheck={vi.fn()}
        onViewDetail={vi.fn()}
      />
    )
    expect(
      (screen.getByRole('button', { name: new RegExp(copy.recheck) }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('视图口径（plan 2026-10-12-device-list-origin-view-filter 轴 2）：计数用 prop 不读 summary', () => {
    // summary 声称 3 台异常，但可见集只有 1 台——汇总条只说可见的那台
    renderNotice({ ...okSummary, signature: 'sig', unavailableCount: 3 }, okStore, ['A 机'], 1)
    expect(
      screen.getByText(
        new RegExp(
          format(copy.unavailableDevices, { count: 1, names: 'A 机', more: '' }).split('（')[0]
        )
      )
    ).toBeTruthy()
  })

  it('P3-C 回归：全量签名非空但视图口径零行 → 不渲染（空横幅不复现）', () => {
    renderNotice({ ...okSummary, signature: 'sig-hidden-only' }, okStore, [], 0)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('P3-C 修复：折叠区内异常设备给计数行，不再闷声吞信息', () => {
    render(
      <DeviceHealthNotice
        summary={{ ...okSummary, signature: 'sig' }}
        storeHealth={okStore}
        unavailableCount={0}
        hiddenAffectedCount={1}
        affectedNames={[]}
        rechecking={false}
        onRecheck={vi.fn()}
        onViewDetail={vi.fn()}
      />
    )
    expect(screen.getByText(format(copy.hiddenOriginUnavailable, { count: 1 }))).toBeTruthy()
  })
})
