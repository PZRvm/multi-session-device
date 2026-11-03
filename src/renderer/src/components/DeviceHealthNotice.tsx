import { Loader2, RefreshCw } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { ReconciliationSummary, StoreHealth } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import Button from './Button'

type DeviceHealthNoticeProps = {
  summary: ReconciliationSummary
  storeHealth: StoreHealth
  /** 文件异常计数（视图口径，plan 2026-10-12-device-list-origin-view-filter 轴 2）：
   * 只数当前可见集——另一来源桶的设备完全不参与顶部异常判定（用户 2026-10-12
   * 复核：隐藏侧异常不进横幅，明细走「查看详情」与折叠区展开后的行内提示） */
  unavailableCount: number
  /** 文件异常设备名（按列表顺序，截断展示） */
  affectedNames: string[]
  /** 重查进行中（按钮转忙碌） */
  rechecking: boolean
  onRecheck: () => void
  onViewDetail: () => void
}

/** 列表上方的对账汇总条（plan 设计 5）：异常持续可见，重查恢复，详情走原生弹窗；
 * 不提供孤立目录自动清理——只列出与保留策略说明。可见性与内容同口径（review
 * P3-C 修复）：没有话说就不出横幅——全量签名非空但视图口径零行时不再渲染空条。 */
const DeviceHealthNotice = ({
  summary,
  storeHealth,
  unavailableCount,
  affectedNames,
  rechecking,
  onRecheck,
  onViewDetail
}: DeviceHealthNoticeProps): React.JSX.Element | null => {
  const copy = useCopy(MAIN_COPY)

  const stateText: Record<StoreHealth['state'], string> = {
    ok: '',
    'read-only': copy.readOnlyState,
    error: copy.errorState
  }
  const lines: string[] = []
  if (storeHealth.state !== 'ok') lines.push(stateText[storeHealth.state])
  if (unavailableCount > 0) {
    const names = affectedNames.slice(0, 3).join('、')
    const more =
      affectedNames.length > 3 ? format(copy.moreSuffix, { count: affectedNames.length }) : ''
    lines.push(format(copy.unavailableDevices, { count: unavailableCount, names, more }))
  }
  if (summary.orphanCount > 0) {
    lines.push(format(copy.orphanAvds, { count: summary.orphanCount }))
  }
  // 可见门跟内容走（P3-C）：签名是全量真值、行是视图口径，两者错位时
  // 曾经渲染出只剩按钮的空横幅——改为有话才出条
  if (lines.length === 0) return null

  return (
    <Wrapper role="status">
      <p className="notice-text">{lines.join('\n')}</p>
      <span className="notice-actions">
        <Button onClick={onRecheck} disabled={rechecking}>
          <span className="action-label">
            {rechecking ? (
              <Loader2 size={14} aria-hidden="true" className="busy-icon" />
            ) : (
              <RefreshCw size={14} />
            )}
            {copy.recheck}
          </span>
        </Button>
        <Button onClick={onViewDetail}>{copy.viewDetail}</Button>
      </span>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
  margin: 8px 10px 12px;
  padding: 10px 12px;
  border: 1px solid var(--board-control-line);
  border-radius: 8px;
  background: var(--board-bg-raised);

  .notice-text {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--board-ink);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .notice-actions {
    display: flex;
    gap: 8px;

    & > button {
      height: 26px;
      font-size: 12px;
      padding: 0 10px;
    }
  }

  .action-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .busy-icon {
    display: block;
    animation: spin 1.2s linear infinite;

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }
`

export default DeviceHealthNotice
