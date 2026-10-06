import { useState } from 'react'
import { Copy, Loader2, Play, Square, Trash2, X } from 'lucide-react'
import styled from 'styled-components'
import type { Device, DeviceStatus } from '@shared/types'
import Input from './Input'

const STATUS_LABELS: Record<DeviceStatus, string> = {
  creating: '创建中',
  stopped: '停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  deleting: '删除中'
}

/** 过渡态（非停止/运行）用琥珀点提示忙碌 */
const isTransitional = (status: DeviceStatus): boolean =>
  status !== 'stopped' && status !== 'running'

type DeviceRowProps = {
  device: Device
  selected: boolean
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onCancelStart: () => void
  onCopySerial: () => void
  onDelete: () => void
  onRename: (name: string) => void
}

/** 设备行：ListRow 视觉（选中整行反白）+ 状态点 + 行内启停/取消/复制/删除 + 双击/F2/选中态 Enter 行内重命名。
 * 行内含按钮，根元素不能用 button（按钮不套按钮），键盘语义手动补。 */
const DeviceRow = ({
  device,
  selected,
  onSelect,
  onStart,
  onStop,
  onCancelStart,
  onCopySerial,
  onDelete,
  onRename
}: DeviceRowProps): React.JSX.Element => {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(device.name)

  const startRename = (): void => {
    if (device.status === 'creating' || device.status === 'deleting') return
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

  const subtitle =
    device.status === 'running' && device.serial
      ? `${device.profileLabel} · API ${device.apiDisplay ?? '?'} · ${device.serial}`
      : `${device.profileLabel} · API ${device.apiDisplay ?? '?'} · ${STATUS_LABELS[device.status]}`

  const deleteDisabled = device.status !== 'stopped' && device.status !== 'running'

  return (
    <Wrapper
      aria-current={selected || undefined}
      aria-keyshortcuts="F2"
      title={device.lastError?.message}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={startRename}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return
        if (event.key === 'F2') {
          event.preventDefault()
          startRename()
        } else if (event.key === 'Enter') {
          event.preventDefault()
          // 选中态再按 Enter 进重命名（macOS Finder 惯例）；未选中维持选中语义
          if (selected) startRename()
          else onSelect()
        } else if (event.key === ' ') {
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
          <Subtitle $selected={selected}>{subtitle}</Subtitle>
          {device.lastError ? (
            <ErrorLine $selected={selected} title={device.lastError.message}>
              {device.lastError.message}
            </ErrorLine>
          ) : null}
        </TextBlock>
      )}
      {/* 行尾动作区整体拦停冒泡，行点击/双击不因误触按钮触发 */}
      <Actions
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {device.status === 'stopped' ? (
          <IconButton
            type="button"
            aria-label={`启动 ${device.name}`}
            title="启动"
            onClick={onStart}
          >
            <Play size={14} />
          </IconButton>
        ) : null}
        {device.status === 'starting' ? (
          <>
            <BusySlot role="img" aria-label={`启动中 ${device.name}`}>
              <BusyIcon aria-hidden="true" />
            </BusySlot>
            <IconButton
              type="button"
              aria-label={`取消启动 ${device.name}`}
              title="取消启动"
              onClick={onCancelStart}
            >
              <X size={14} />
            </IconButton>
          </>
        ) : null}
        {device.status === 'running' ? (
          <>
            <IconButton
              type="button"
              aria-label={`停止 ${device.name}`}
              title="停止"
              onClick={onStop}
            >
              <Square size={14} />
            </IconButton>
            <IconButton
              type="button"
              aria-label={`复制 serial（${device.serial ?? ''}）`}
              title="复制 serial"
              onClick={onCopySerial}
            >
              <Copy size={14} />
            </IconButton>
          </>
        ) : null}
        {device.status === 'stopping' ? (
          <>
            <BusySlot role="img" aria-label={`停止中 ${device.name}`}>
              <BusyIcon aria-hidden="true" />
            </BusySlot>
            {/* 停止失败保留重试入口；未失败时点击无害（合并到在途清理） */}
            <IconButton
              type="button"
              aria-label={`重试停止 ${device.name}`}
              title="停止"
              onClick={onStop}
            >
              <Square size={14} />
            </IconButton>
          </>
        ) : null}
        <IconButton
          type="button"
          aria-label={`删除 ${device.name}`}
          title="删除"
          disabled={deleteDisabled}
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
`

const StatusDot = styled.span<{ $status: DeviceStatus }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $status }) =>
    $status === 'running'
      ? 'var(--loading)'
      : isTransitional($status)
        ? 'var(--board-tile-ink)'
        : 'var(--idle)'};
`

/** 忙态槽位：与 IconButton 同尺寸的非交互容器，加载图标与按钮图标共用同一水平中心 */
const BusySlot = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
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

const ErrorLine = styled.span<{ $selected: boolean }>`
  font-size: 11px;
  line-height: 1.4;
  color: var(--board-tile-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${({ $selected }) =>
    $selected &&
    `
      color: inherit;
      opacity: 0.85;
    `}
`

const RenameInput = styled(Input)`
  flex: 1;
  min-width: 0;
`

const Actions = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
`

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default DeviceRow
