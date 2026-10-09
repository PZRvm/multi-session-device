import { useState } from 'react'
import { Copy, Loader2, Play, Settings2, Square, Trash2, X } from 'lucide-react'
import styled from 'styled-components'
import type { Device, DeviceAvailability, DeviceStatus } from '@shared/types'
import Input from './Input'

const STATUS_LABELS: Record<DeviceStatus, string> = {
  creating: '创建中',
  stopped: '停止',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  deleting: '删除中'
}

const AVAILABILITY_LABELS: Record<DeviceAvailability['state'], string> = {
  checking: '检查中',
  valid: '正常',
  missing: '文件缺失',
  broken: '文件损坏',
  inaccessible: '无法访问',
  unsafe: '路径不安全'
}

/** 健康原因行：优先展示阻断原因；warning（如镜像身份不同）也提示 */
const availabilityReason = (availability: DeviceAvailability): string => {
  const blocking = availability.issues.find((issue) => issue.severity === 'error')
  const hint = blocking ?? availability.issues[0]
  return hint !== undefined
    ? `${AVAILABILITY_LABELS[availability.state]}：${hint.message}`
    : AVAILABILITY_LABELS[availability.state]
}

type DeviceRowProps = {
  device: Device
  selected: boolean
  /** 库可信（storeHealth 非 error）：不可信时元数据无法信任，禁止启动 */
  storeTrusted: boolean
  /** 库可写（storeHealth 为 ok）：read-only 时禁改删与重命名 */
  metaWritable: boolean
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onCancelStart: () => void
  onCopySerial: () => void
  onDelete: () => void
  onRename: (name: string) => void
  /** 打开配置编辑窗（运行中也可查看，保存要求停止） */
  onEdit: () => void
  /** read-only 下尝试重命名（双击/F2）时的反馈入口（review P3——静默 no-op 无说明） */
  onRenameBlocked?: () => void
}

/** 设备行：ListRow 视觉（选中整行反白）+ 状态点 + 行内启停/取消/复制/删除 + 双击/F2/选中态 Enter 行内重命名。
 * 健康原因独立于运行态展示：stopped 且非 valid（含检查中）禁启动；运行中异常不清画面只挂原因。
 * 行内含按钮，根元素不能用 button（按钮不套按钮），键盘语义手动补。 */
const DeviceRow = ({
  device,
  selected,
  storeTrusted,
  metaWritable,
  onSelect,
  onStart,
  onStop,
  onCancelStart,
  onCopySerial,
  onDelete,
  onRename,
  onEdit,
  onRenameBlocked
}: DeviceRowProps): React.JSX.Element => {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(device.name)

  const availability = device.availability ?? null
  const healthLine =
    availability !== null && availability.state !== 'valid'
      ? availabilityReason(availability)
      : null

  // stopped 且 checking/非 valid 禁启动；库不可信（error）同样禁——元数据无法信任
  const startDisabled =
    device.status === 'stopped' &&
    (!storeTrusted || availability === null || availability.state !== 'valid')
  const deleteDisabled =
    !metaWritable || (device.status !== 'stopped' && device.status !== 'running')

  const startRename = (): void => {
    if (device.status === 'creating' || device.status === 'deleting') return
    if (!metaWritable) {
      onRenameBlocked?.()
      return
    }
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
      <span
        className="status-dot"
        data-status={device.status}
        role="img"
        aria-label={`状态：${STATUS_LABELS[device.status]}`}
      />
      {renaming ? (
        <Input
          className="rename-input"
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
        <span className="text-block">
          <span className="title">{device.name}</span>
          <span className="subtitle">{subtitle}</span>
          {healthLine !== null ? (
            <span className="health-line" title={healthLine}>
              {healthLine}
            </span>
          ) : null}
          {device.lastError ? (
            <span className="error-line" title={device.lastError.message}>
              {device.lastError.message}
            </span>
          ) : null}
          {device.cameraNotice ? (
            <span className="notice-line" title={device.cameraNotice}>
              {device.cameraNotice}
            </span>
          ) : null}
        </span>
      )}
      {/* 行尾动作区整体拦停冒泡，行点击/双击不因误触按钮触发 */}
      <span
        className="actions"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {device.status === 'stopped' ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`启动 ${device.name}`}
            title={startDisabled ? '设备文件异常或仍在检查，暂不能启动（可先重新检查）' : '启动'}
            disabled={startDisabled}
            onClick={onStart}
          >
            <Play size={14} />
          </button>
        ) : null}
        {device.status === 'starting' ? (
          <>
            <span className="busy-slot" role="img" aria-label={`启动中 ${device.name}`}>
              <Loader2 size={14} aria-hidden="true" className="busy-icon" />
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label={`取消启动 ${device.name}`}
              title="取消启动"
              onClick={onCancelStart}
            >
              <X size={14} />
            </button>
          </>
        ) : null}
        {device.status === 'running' ? (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label={`停止 ${device.name}`}
              title="停止"
              onClick={onStop}
            >
              <Square size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`复制 serial（${device.serial ?? ''}）`}
              title="复制 serial"
              onClick={onCopySerial}
            >
              <Copy size={14} />
            </button>
          </>
        ) : null}
        {device.status === 'stopping' ? (
          <>
            <span className="busy-slot" role="img" aria-label={`停止中 ${device.name}`}>
              <Loader2 size={14} aria-hidden="true" className="busy-icon" />
            </span>
            {/* 停止失败保留重试入口；未失败时点击无害（合并到在途清理） */}
            <button
              type="button"
              className="icon-button"
              aria-label={`重试停止 ${device.name}`}
              title="停止"
              onClick={onStop}
            >
              <Square size={14} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label={`编辑配置 ${device.name}`}
          title={
            device.status === 'creating' || device.status === 'deleting'
              ? '设备事务进行中，暂不能编辑配置'
              : '编辑配置（保存前需停止模拟器）'
          }
          disabled={device.status === 'creating' || device.status === 'deleting'}
          onClick={onEdit}
        >
          <Settings2 size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`删除 ${device.name}`}
          title={metaWritable ? '删除' : '元数据写入已冻结，暂不能删除（详情见列表上方汇总）'}
          disabled={deleteDisabled}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </span>
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

  .status-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--idle);
  }

  .status-dot[data-status='running'] {
    background: var(--loading);
  }

  /* 过渡态（非停止/运行）用琥珀点提示忙碌 */
  .status-dot[data-status='creating'],
  .status-dot[data-status='starting'],
  .status-dot[data-status='stopping'],
  .status-dot[data-status='deleting'] {
    background: var(--board-tile-ink);
  }

  /* 选中态反白后原状态色在 accent 背景上对比不足（灰 2.6:1、深琥珀约 3:1），与文字行同口径改用 ink */
  &[aria-current] .status-dot {
    background: var(--accent-ink);
    opacity: 0.85;
  }

  /* 忙态槽位：与 icon-button 同尺寸的非交互容器，加载图标与按钮图标共用同一水平中心 */
  .busy-slot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 24px;
    height: 24px;
  }

  .busy-icon {
    display: block;
    animation: spin 1.2s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .busy-icon {
      animation: none;
    }
  }

  .text-block {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    font-size: 12px;
    line-height: 1.5;
    color: var(--board-ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[aria-current] .subtitle {
    color: inherit;
    opacity: 0.72;
  }

  .error-line {
    font-size: 11px;
    line-height: 1.4;
    color: var(--board-tile-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[aria-current] .error-line {
    color: inherit;
    opacity: 0.85;
  }

  /* 健康原因行（对账）：独立于 lastError 的文件健康提示 */
  .health-line {
    font-size: 11px;
    line-height: 1.4;
    color: var(--board-ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[aria-current] .health-line {
    color: inherit;
    opacity: 0.78;
  }

  /* 摄像头回退说明（启动仲裁命中）：运行会话内提示，停止即清除 */
  .notice-line {
    font-size: 11px;
    line-height: 1.4;
    color: var(--board-ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[aria-current] .notice-line {
    color: inherit;
    opacity: 0.78;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
  }

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  .icon-button {
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
  }

  .icon-button:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  .icon-button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default DeviceRow
