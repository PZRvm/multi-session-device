import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReconciliationSummary, StoreHealth } from '@shared/types'
import DeviceHealthNotice from '../DeviceHealthNotice'

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
  affectedNames: string[] = []
): { onRecheck: ReturnType<typeof vi.fn>; onViewDetail: ReturnType<typeof vi.fn> } => {
  const onRecheck = vi.fn()
  const onViewDetail = vi.fn()
  render(
    <DeviceHealthNotice
      summary={summary}
      storeHealth={storeHealth}
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
    expect(screen.getByText(/设备元数据读取失败/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
    expect(onViewDetail).toHaveBeenCalledTimes(1)
  })

  it('设备异常 + 孤立组：数量与设备名可见，重查回调触发', () => {
    const { onRecheck } = renderNotice(
      { ...okSummary, signature: 'sig-2', unavailableCount: 2, orphanCount: 3 },
      okStore,
      ['A 机', 'B 机', 'C 机', 'D 机']
    )
    expect(screen.getByText(/2 台设备文件异常（A 机、B 机、C 机 等 4 台）/)).toBeTruthy()
    expect(screen.getByText(/3 组 AVD 文件没有对应设备记录/)).toBeTruthy()
    expect(screen.getByText(/不自动清理/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /重新检查/ }))
    expect(onRecheck).toHaveBeenCalledTimes(1)
  })

  it('重查进行中按钮禁用（忙碌态）', () => {
    render(
      <DeviceHealthNotice
        summary={{ ...okSummary, signature: 'sig', unavailableCount: 1 }}
        storeHealth={okStore}
        affectedNames={['A 机']}
        rechecking={true}
        onRecheck={vi.fn()}
        onViewDetail={vi.fn()}
      />
    )
    expect((screen.getByRole('button', { name: /重新检查/ }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})
