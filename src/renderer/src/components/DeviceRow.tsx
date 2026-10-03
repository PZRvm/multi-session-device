import { useState } from 'react'
import { Play, Square, Trash2 } from 'lucide-react'
import styled from 'styled-components'
import type { Device } from '@shared/types'
import Input from './Input'

const STATUS_LABELS: Record<Device['status'], string> = {
  stopped: '停止',
  running: '运行中'
}

type DeviceRowProps = {
  device: Device
  selected: boolean
  onSelect: () => void
  onToggleRunning: (running: boolean) => void
  onDelete: () => void
  onRename: (name: string) => void
}

/** 设备行：ListRow 视觉（选中整行反白）+ 状态点 + 行内启停/删除 + 双击行内重命名。
 * 行内含按钮，根元素不能用 button（按钮不套按钮），键盘语义手动补。 */
const DeviceRow = ({
  device,
  selected,
  onSelect,
  onToggleRunning,
  onDelete,
  onRename
}: DeviceRowProps): React.JSX.Element => {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(device.name)

  const startRename = (): void => {
    setDraft(device.name)
    setRenaming(true)
  }

  const commitRename = (): void => {
    // Esc 先行置 renaming=false，迟到的 blur 不得再提交
    if (!renaming) return
    const name = draft.trim()
    if (name.length > 0 && name !== device.name) onRename(name)
    setRenaming(false)
  }

  const cancelRename = (): void => {
    setRenaming(false)
  }

  return (
    <Wrapper
      aria-current={selected || undefined}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={startRename}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <StatusDot
        $status={device.status}
        role="img"
        aria-label={`状态：${STATUS_LABELS[device.status]}`}
      />
      {renaming ? (
        <RenameInput
          value={draft}
          maxLength={50}
          aria-label="重命名设备"
          autoFocus
          onFocus={(event) => event.target.select()}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commitRename()
            else if (event.key === 'Escape') cancelRename()
          }}
          onBlur={commitRename}
        />
      ) : (
        <TextBlock>
          <Title>{device.name}</Title>
          <Subtitle $selected={selected}>
            {device.profileLabel} · API {device.apiLevel} · {STATUS_LABELS[device.status]}
          </Subtitle>
        </TextBlock>
      )}
      {/* 行尾动作区整体拦停冒泡，行点击/双击不因误触按钮触发 */}
      <Actions
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <IconButton
          type="button"
          aria-label={device.status === 'running' ? `停止 ${device.name}` : `启动 ${device.name}`}
          title={device.status === 'running' ? '停止' : '启动'}
          onClick={() => onToggleRunning(device.status !== 'running')}
        >
          {device.status === 'running' ? <Square size={14} /> : <Play size={14} />}
        </IconButton>
        <IconButton
          type="button"
          aria-label={`删除 ${device.name}`}
          title="删除"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </IconButton>
      </Actions>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--board-bg);
  color: var(--board-ink);
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-bg-raised);
  }

  &[aria-current] {
    background: var(--accent);
    color: var(--accent-ink);
  }

  &[aria-current]:hover {
    background: var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* 删除钮悬停浮现（键盘聚焦同样浮现，见 IconButton） */
  &:hover button:nth-child(2) {
    opacity: 1;
  }
`

const StatusDot = styled.span<{ $status: Device['status'] }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $status }) => ($status === 'running' ? 'var(--loading)' : 'var(--idle)')};
`

const TextBlock = styled.span`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
`

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Subtitle = styled.span<{ $selected: boolean }>`
  font-size: 12px;
  line-height: 1.5;
  color: var(--board-ink-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ $selected }) =>
    $selected &&
    `
      color: inherit;
      opacity: 0.72;
    `}
`

const RenameInput = styled(Input)`
  flex: 1;
  min-width: 0;
`

const Actions = styled.span`
  display: inline-flex;
  gap: 2px;
  flex: none;
`

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* 删除钮（行尾第 2 颗）默认隐藏，行 hover 或自身键盘聚焦时浮现 */
  &:nth-child(2) {
    opacity: 0;
  }

  &:nth-child(2):focus-visible {
    opacity: 1;
  }
`

export default DeviceRow
