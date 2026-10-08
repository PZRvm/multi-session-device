import { Loader2, RefreshCw } from 'lucide-react'
import styled from 'styled-components'
import type { ReconciliationSummary, StoreHealth } from '@shared/types'
import Button from './Button'

type DeviceHealthNoticeProps = {
  summary: ReconciliationSummary
  storeHealth: StoreHealth
  /** 文件异常设备名（按列表顺序，截断展示） */
  affectedNames: string[]
  /** 重查进行中（按钮转忙碌） */
  rechecking: boolean
  onRecheck: () => void
  onViewDetail: () => void
}

const STORE_STATE_TEXT: Record<StoreHealth['state'], string> = {
  ok: '',
  'read-only': '设备元数据写入已冻结（可继续启动已有设备；修复 devices.json 后重新检查）',
  error: '设备元数据读取失败（devices.json 异常，原文件已保留）'
}

/** 列表上方的对账汇总条（plan 设计 5）：异常持续可见，重查恢复，详情走原生弹窗；
 * 不提供孤立目录自动清理——只列出与保留策略说明。 */
const DeviceHealthNotice = ({
  summary,
  storeHealth,
  affectedNames,
  rechecking,
  onRecheck,
  onViewDetail
}: DeviceHealthNoticeProps): React.JSX.Element | null => {
  const visible =
    summary.signature !== null || storeHealth.state !== 'ok' || summary.orphanCount > 0
  if (!visible) return null

  const lines: string[] = []
  if (storeHealth.state !== 'ok') lines.push(STORE_STATE_TEXT[storeHealth.state])
  if (summary.unavailableCount > 0) {
    const names = affectedNames.slice(0, 3).join('、')
    const more = affectedNames.length > 3 ? ` 等 ${affectedNames.length} 台` : ''
    lines.push(`${summary.unavailableCount} 台设备文件异常（${names}${more}），启动已禁用`)
  }
  if (summary.orphanCount > 0) {
    lines.push(`${summary.orphanCount} 组 AVD 文件没有对应设备记录（仅列出，不自动清理；详见详情）`)
  }

  return (
    <Wrapper role="status">
      <Text>{lines.join('\n')}</Text>
      <Actions>
        <Button onClick={onRecheck} disabled={rechecking}>
          <ActionLabel>
            {rechecking ? <BusyIcon aria-hidden="true" /> : <RefreshCw size={14} />}
            重新检查
          </ActionLabel>
        </Button>
        <Button onClick={onViewDetail}>查看详情</Button>
      </Actions>
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
`

const Text = styled.p`
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--board-ink);
  white-space: pre-line;
  overflow-wrap: anywhere;
`

const Actions = styled.span`
  display: flex;
  gap: 8px;

  & > button {
    height: 26px;
    font-size: 12px;
    padding: 0 10px;
  }
`

const ActionLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`

const BusyIcon = styled(Loader2).attrs({ size: 14 })`
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
`

export default DeviceHealthNotice
