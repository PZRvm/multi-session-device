import { useState } from 'react'
import { Building2, Copy, Loader2, Pause, Play, Settings2, Square, Trash2, X } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { Device, DeviceAvailability, DeviceStatus } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import type { RowDragProps } from '../hooks/useListDragReorder'
import Input from './Input'
import RecordingStatus from './RecordingStatus'
import { PopoverIconButton } from './PopoverIconButton'

/** 健康原因行：优先展示阻断原因；warning（如镜像身份不同）也提示 */
const availabilityReason = (
  availability: DeviceAvailability,
  labels: Record<DeviceAvailability['state'], string>
): string => {
  const blocking = availability.issues.find((issue) => issue.severity === 'error')
  const hint = blocking ?? availability.issues[0]
  return hint !== undefined
    ? `${labels[availability.state]}：${hint.message}`
    : labels[availability.state]
}

type DeviceRowProps = {
  device: Device
  selected: boolean
  /** 库可信（storeHealth 非 error）：不可信时元数据无法信任，禁止启动 */
  storeTrusted: boolean
  /** 库可写（storeHealth 为 ok）：read-only 时禁改删与重命名 */
  metaWritable: boolean
  /** 跨来源桶（出身≠当前来源，含运行豁免显示的他桶设备）：另一侧设备不可修改
   * （plan 用户复核 5）——编辑/删除禁用、重命名拦截，停止/取消不受限 */
  crossBucket?: boolean
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onCancelStart: () => void
  /** 手动休眠（保存快照释放进程）；退出失败后的重试共用本入口 */
  onHibernate: () => void
  /** 从休眠恢复 */
  onResume: () => void
  onCopySerial: () => void
  onDelete: () => void
  onRename: (name: string) => void
  /** 打开配置编辑窗（运行中也可查看，保存要求停止） */
  onEdit: () => void
  /** read-only 下尝试重命名（双击/F2）时的反馈入口（review P3——静默 no-op 无说明） */
  onRenameBlocked?: () => void
  /** 跨来源桶设备尝试修改（重命名路径）时的反馈入口 */
  onCrossBucketBlocked?: () => void
  /** 拖拽换序（plan 2026-11-09）：行根挂标识与视觉态；折叠区/过渡行不传即不可拖
   *  不可锚；renaming 态行内自禁拖（输入框需可选可编辑） */
  drag?: RowDragProps
}

/** 设备行：ListRow 视觉（选中整行反白）+ 状态点 + 行内启停/取消/复制/删除 + 双击/F2/选中态 Enter 行内重命名。
 * 健康原因独立于运行态展示：stopped 且非 valid（含检查中）禁启动；运行中异常不清画面只挂原因。
 * 行内含按钮，根元素不能用 button（按钮不套按钮），键盘语义手动补。 */
const DeviceRow = ({
  device,
  selected,
  storeTrusted,
  metaWritable,
  crossBucket = false,
  onSelect,
  onStart,
  onStop,
  onCancelStart,
  onHibernate,
  onResume,
  onCopySerial,
  onDelete,
  onRename,
  onEdit,
  onRenameBlocked,
  onCrossBucketBlocked,
  drag
}: DeviceRowProps): React.JSX.Element => {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(device.name)
  const copy = useCopy(MAIN_COPY)

  const statusLabels: Record<DeviceStatus, string> = {
    creating: copy.statusCreating,
    stopped: copy.statusStopped,
    starting: copy.statusStarting,
    running: copy.statusRunning,
    stopping: copy.statusStopping,
    deleting: copy.statusDeleting,
    hibernating: copy.statusHibernating,
    hibernated: copy.statusHibernated,
    resuming: copy.statusResuming
  }
  const availabilityLabels: Record<DeviceAvailability['state'], string> = {
    checking: copy.availChecking,
    valid: copy.availValid,
    missing: copy.availMissing,
    broken: copy.availBroken,
    inaccessible: copy.availInaccessible,
    unsafe: copy.availUnsafe
  }

  const availability = device.availability ?? null
  const healthLine =
    availability !== null && availability.state !== 'valid'
      ? availabilityReason(availability, availabilityLabels)
      : null

  // stopped 且 checking/非 valid 禁启动；库不可信（error）同样禁——元数据无法信任；
  // 跨桶 stopped 设备禁启动（review P3-3 决策：另一侧只读到底——从这边启动会让
  // 设备跳进当前视图、停止后又折回，视图跳动且语义越界；运行豁免设备不受影响）
  const startDisabled =
    device.status === 'stopped' &&
    (crossBucket || !storeTrusted || availability === null || availability.state !== 'valid')
  // 用户删除入口仅停止态渲染（plan 2026-11-06 设计 E）：运行/过渡/休眠态无 DOM 焦点入口
  const deleteRenderable = device.status === 'stopped'
  const deleteDisabled = !metaWritable || crossBucket
  // 休眠能力门控（main 派生字段）：不可用时按钮禁用并以原因说明，不放行可执行入口
  const hibernateDisabled = device.hibernationAvailable !== true

  const startRename = (): void => {
    if (device.status === 'creating' || device.status === 'deleting') return
    if (crossBucket) {
      onCrossBucketBlocked?.()
      return
    }
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
      : `${device.profileLabel} · API ${device.apiDisplay ?? '?'} · ${statusLabels[device.status]}`

  return (
    <Wrapper
      aria-current={selected || undefined}
      aria-keyshortcuts="F2"
      title={device.lastError?.message}
      tabIndex={0}
      data-avd-drag-id={drag ? device.id : undefined}
      draggable={drag ? drag.draggable && !renaming : undefined}
      data-drop-pos={drag?.dropPos ?? undefined}
      className={drag?.isSource ? 'drag-source' : undefined}
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
        aria-label={format(copy.statusAria, { status: statusLabels[device.status] })}
      />
      {renaming ? (
        <Input
          className="rename-input"
          value={draft}
          maxLength={50}
          aria-label={copy.renameAria}
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
          <span className="title">
            {device.name}
            {/* 出身徽标（plan 2026-10-12-device-list-source-aware）：仅共享来源出身
                显示——项目自有是默认世界，减噪；tooltip 全称给足语义 */}
            {device.imageSourceOrigin === 'shared-studio' ? (
              <span
                className="origin-badge"
                title={copy.deviceOriginStudio}
                aria-label={copy.deviceOriginStudio}
              >
                <Building2 size={11} aria-hidden="true" />
              </span>
            ) : null}
          </span>
          <span className="subtitle">{subtitle}</span>
          <RecordingStatus deviceId={device.id} />
          {healthLine !== null ? (
            <span className="health-line" title={healthLine}>
              {healthLine}
            </span>
          ) : null}
          {device.lastError ? (
            <>
              <span className="error-line" title={device.lastError.message}>
                {device.lastError.message}
              </span>
              {device.lastError.code === 'whpx-missing' ? (
                <button
                  type="button"
                  className="error-action"
                  aria-label={copy.openWindowsFeatures}
                  onClick={() => void window.api.dialog.openWindowsFeatures()}
                >
                  {copy.openWindowsFeatures}
                </button>
              ) : null}
            </>
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
          <PopoverIconButton
            icon={<Play size={14} />}
            label={copy.start}
            ariaLabel={format(copy.startAria, { name: device.name })}
            detail={
              crossBucket && device.status === 'stopped'
                ? copy.crossBucketBlockedTitle
                : startDisabled
                  ? copy.startDisabledTitle
                  : null
            }
            disabled={startDisabled}
            onClick={onStart}
          />
        ) : null}
        {device.status === 'starting' ? (
          <>
            <PopoverIconButton
              busy
              icon={<Loader2 size={14} aria-hidden="true" className="busy-icon" />}
              label={statusLabels.starting}
              ariaLabel={format(copy.startingAria, { name: device.name })}
            />
            <PopoverIconButton
              icon={<X size={14} />}
              label={copy.cancelStart}
              ariaLabel={format(copy.cancelStartAria, { name: device.name })}
              onClick={onCancelStart}
            />
          </>
        ) : null}
        {device.status === 'running' ? (
          <>
            <PopoverIconButton
              icon={<Pause size={14} />}
              label={copy.hibernateAction}
              ariaLabel={format(copy.hibernateAria, { name: device.name })}
              detail={
                hibernateDisabled
                  ? (device.hibernationDisabledReason ?? copy.hibernateUnsupported)
                  : null
              }
              disabled={hibernateDisabled}
              onClick={onHibernate}
            />
            <PopoverIconButton
              icon={<Square size={14} />}
              label={copy.stop}
              ariaLabel={format(copy.stopAria, { name: device.name })}
              onClick={onStop}
            />
            <PopoverIconButton
              icon={<Copy size={14} />}
              label={copy.copySerial}
              ariaLabel={format(copy.copySerialAria, { serial: device.serial ?? '' })}
              onClick={onCopySerial}
            />
          </>
        ) : null}
        {device.status === 'hibernating' ? (
          <>
            <PopoverIconButton
              busy
              icon={<Loader2 size={14} aria-hidden="true" className="busy-icon" />}
              label={statusLabels.hibernating}
              ariaLabel={format(copy.hibernatingAria, { name: device.name })}
            />
            {/* 退出失败的重试/停止出口（保存失败已自动回运行态） */}
            {device.lastError?.code === 'hibernate-exit-failed' ? (
              <>
                <PopoverIconButton
                  icon={<Pause size={14} />}
                  label={copy.hibernateRetryAction}
                  ariaLabel={format(copy.retryHibernateAria, { name: device.name })}
                  detail={copy.hibernateRetryTitle}
                  onClick={onHibernate}
                />
                <PopoverIconButton
                  icon={<Square size={14} />}
                  label={copy.stop}
                  ariaLabel={format(copy.stopAria, { name: device.name })}
                  detail={copy.hibernateGiveUpStopTitle}
                  onClick={onStop}
                />
              </>
            ) : null}
          </>
        ) : null}
        {device.status === 'hibernated' ? (
          <PopoverIconButton
            icon={<Play size={14} />}
            label={copy.resumeAction}
            ariaLabel={format(copy.resumeAria, { name: device.name })}
            onClick={onResume}
          />
        ) : null}
        {device.status === 'resuming' ? (
          <>
            <PopoverIconButton
              busy
              icon={<Loader2 size={14} aria-hidden="true" className="busy-icon" />}
              label={statusLabels.resuming}
              ariaLabel={format(copy.resumingAria, { name: device.name })}
            />
            <PopoverIconButton
              icon={<X size={14} />}
              label={copy.cancelResumeAction}
              ariaLabel={format(copy.cancelResumeAria, { name: device.name })}
              onClick={onCancelStart}
            />
          </>
        ) : null}
        {device.status === 'stopping' ? (
          <>
            <PopoverIconButton
              busy
              icon={<Loader2 size={14} aria-hidden="true" className="busy-icon" />}
              label={statusLabels.stopping}
              ariaLabel={format(copy.stoppingAria, { name: device.name })}
            />
            {/* 停止失败保留重试入口；未失败时点击无害（合并到在途清理） */}
            <PopoverIconButton
              icon={<Square size={14} />}
              label={copy.stop}
              ariaLabel={format(copy.retryStopAria, { name: device.name })}
              onClick={onStop}
            />
          </>
        ) : null}
        <PopoverIconButton
          icon={<Settings2 size={14} />}
          label={copy.editAction}
          ariaLabel={format(copy.editAria, { name: device.name })}
          detail={
            crossBucket && device.status !== 'running'
              ? copy.crossBucketBlockedTitle
              : device.status === 'creating' || device.status === 'deleting'
                ? copy.editBusyTitle
                : null
          }
          disabled={
            (crossBucket && device.status !== 'running') ||
            device.status === 'creating' ||
            device.status === 'deleting'
          }
          onClick={onEdit}
        />
        {deleteRenderable ? (
          <PopoverIconButton
            icon={<Trash2 size={14} />}
            label={copy.delete}
            ariaLabel={format(copy.deleteAria, { name: device.name })}
            detail={
              crossBucket
                ? copy.crossBucketBlockedTitle
                : metaWritable
                  ? null
                  : copy.deleteFrozenTitle
            }
            disabled={deleteDisabled}
            onClick={onDelete}
          />
        ) : null}
      </span>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  position: relative;
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

  /* 拖拽换序（plan 2026-11-09）：可拖行禁选字（编辑态行 draggable=false 天然可选可编）；
     源行半透明 + 目标行插入线——灰阶墨级，排序是纯结构操作不进主题强调色 */
  &[draggable='true'] {
    user-select: none;
  }

  &.drag-source {
    opacity: 0.45;
  }

  &[data-drop-pos='before']::before,
  &[data-drop-pos='after']::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--board-ink);
    pointer-events: none;
  }

  &[data-drop-pos='before']::before {
    top: -1px;
  }

  &[data-drop-pos='after']::after {
    bottom: -1px;
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

  /* 过渡态（非停止/运行）用琥珀点提示忙碌；休眠事务过渡同口径 */
  .status-dot[data-status='creating'],
  .status-dot[data-status='starting'],
  .status-dot[data-status='stopping'],
  .status-dot[data-status='deleting'],
  .status-dot[data-status='hibernating'],
  .status-dot[data-status='resuming'] {
    background: var(--board-tile-ink);
  }

  /* 已休眠：现场已保存、进程已释放——用主题 accent 弱化色区分于停止 */
  .status-dot[data-status='hibernated'] {
    background: var(--loading);
    opacity: 0.55;
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

  /* 出身徽标（共享来源设备）：名称行尾小图标，tooltip 承载全称 */
  .origin-badge {
    display: inline-flex;
    align-items: center;
    flex: none;
    margin-left: 5px;
    vertical-align: -1px;
    color: var(--board-ink-dim);
  }

  &[aria-current] .origin-badge {
    color: inherit;
    opacity: 0.78;
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

  /* WHPX 引导动作（plan 2026-10-22-windows-emulator-env）：仅随 whpx-missing code 出现 */
  .error-action {
    font-size: 11px;
    line-height: 1.4;
    padding: 0;
    border: none;
    background: none;
    color: var(--board-tile-ink);
    text-decoration: underline;
    cursor: pointer;
    flex: none;

    &:hover {
      opacity: 0.8;
    }

    &:focus-visible {
      outline: 1px solid currentColor;
      outline-offset: 2px;
    }
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
