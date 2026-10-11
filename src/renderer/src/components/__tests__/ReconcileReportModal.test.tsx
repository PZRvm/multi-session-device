// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAIN_COPY } from '@shared/i18n'
import type { ReconcileReport } from '@shared/types'
import ReconcileReportModal from '../ReconcileReportModal'

afterEach(cleanup)
const copy = MAIN_COPY['zh-CN']

const reportOf = (over: Partial<ReconcileReport> = {}): ReconcileReport => ({
  revision: 12,
  signature: 'sig',
  checkedAt: 1_760_000_000_000,
  storeHealth: { state: 'ok', issues: [] },
  deviceIssues: [
    {
      id: 'd1',
      name: 'MST-01 · Pixel 8',
      availability: {
        state: 'broken',
        checkedAt: null,
        issues: [
          { component: 'image', code: 'image-missing', message: '镜像目录缺失', severity: 'error' }
        ]
      }
    }
  ],
  orphanEntries: [{ id: 'a1b2c3d4', kind: 'orphan', detail: '完整组（无元数据记录）' }],
  unrecognizedCount: 2,
  pendingIds: [],
  scanError: null,
  pendingNotification: false,
  ...over
})

describe('ReconcileReportModal（完整查看面板，plan 2026-10-12）', () => {
  it('分组渲染完整报告：元数据/设备异常/孤立组/其他各就位', async () => {
    render(
      <ReconcileReportModal
        onClose={vi.fn()}
        fetchReport={async () =>
          reportOf({
            storeHealth: {
              state: 'read-only',
              issues: [{ code: 'bad-entry', message: '条目 3 损坏' }]
            },
            scanError: '部分目录不可读'
          })
        }
      />
    )
    await screen.findByText('条目 3 损坏', { exact: false })
    expect(screen.getByText('「MST-01 · Pixel 8」镜像：镜像目录缺失')).toBeTruthy()
    expect(screen.getByText(/a1b2c3d4/)).toBeTruthy()
    expect(screen.getByText(copy.reportGroupOther)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('120 条设备明细全渲染（回归锚：完整信息量不受弹窗截断影响）', async () => {
    const deviceIssues = Array.from({ length: 120 }, (_, i) => ({
      id: `d${i}`,
      name: `设备 ${i}`,
      availability: {
        state: 'broken' as const,
        checkedAt: null,
        issues: [
          {
            component: 'avd' as const,
            code: 'x',
            message: `异常 ${i}`,
            severity: 'warning' as const
          }
        ]
      }
    }))
    render(
      <ReconcileReportModal
        onClose={vi.fn()}
        fetchReport={async () => reportOf({ deviceIssues, orphanEntries: [] })}
      />
    )
    await screen.findByText('「设备 0」AVD：异常 0')
    expect(screen.getByText('「设备 119」AVD：异常 119')).toBeTruthy()
    expect(screen.getAllByText(/AVD：异常/)).toHaveLength(120)
  })

  it('无异常报告 → 空态文案；报告 null 同样空态', async () => {
    const clean: ReconcileReport = {
      ...reportOf(),
      deviceIssues: [],
      orphanEntries: [],
      unrecognizedCount: 0,
      storeHealth: { state: 'ok', issues: [] }
    }
    const { unmount } = render(
      <ReconcileReportModal onClose={vi.fn()} fetchReport={async () => clean} />
    )
    await screen.findByText(copy.noAbnormalRecords)
    unmount()
    render(<ReconcileReportModal onClose={vi.fn()} fetchReport={async () => null} />)
    await screen.findByText(copy.noAbnormalRecords)
  })

  it('拉取失败 → 错误行 + 重试成功切换渲染', async () => {
    let fail = true
    render(
      <ReconcileReportModal
        onClose={vi.fn()}
        fetchReport={async () => {
          if (fail) throw new Error('boom')
          return reportOf()
        }}
      />
    )
    await screen.findByText(/报告加载失败：boom/)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: copy.reportRetry }))
    await screen.findByText('「MST-01 · Pixel 8」镜像：镜像目录缺失')
  })
})
