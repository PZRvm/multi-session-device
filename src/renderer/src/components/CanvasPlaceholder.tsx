import { Moon, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { Device, StoreHealthState } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import Button from './Button'

type CanvasPlaceholderProps = {
  device: Device | null
  onCreate: () => void
  /** 人工重查（对账）：异常停止设备与读取失败态的恢复入口 */
  onRecheck: () => void
  /** store error：无设备时显示「读取失败」而非普通空库 */
  storeState: StoreHealthState
  /** 元数据写入冻结（read-only/error）时禁用新建入口（plan 设计 5） */
  createDisabled?: boolean
  /** 重查进行中：重查钮转忙碌禁用（review P3——与汇总条口径一致） */
  rechecking?: boolean
  /** 已休眠设备的恢复入口（plan 2026-11-06 设计 F：占位画面提供恢复与放弃） */
  onResume?: () => void
  /** 已休眠设备的「放弃休眠状态」入口（确认在 App 层完成） */
  onDiscard?: () => void
}

/** 健康原因展示：阻断原因优先，warning 次之 */
const healthHint = (device: Device): string | null => {
  const availability = device.availability
  if (availability === undefined || availability.state === 'valid') return null
  const hint =
    availability.issues.find((issue) => issue.severity === 'error') ?? availability.issues[0]
  return hint !== undefined ? hint.message : null
}

/** 右栏画面占位区：反映选中设备的真实状态与文件健康；运行中画面由 DeviceCanvas 接管。
 *  已休眠占位不是「实时画面」：说明资源已释放，并提供恢复/放弃动作。 */
const CanvasPlaceholder = ({
  device,
  onCreate,
  onRecheck,
  storeState,
  createDisabled = false,
  rechecking = false,
  onResume,
  onDiscard
}: CanvasPlaceholderProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const stateHints: Record<Device['status'], string> = {
    creating: copy.hintCreating,
    stopped: copy.hintStopped,
    starting: copy.hintStarting,
    running: copy.hintRunning,
    stopping: copy.hintStopping,
    deleting: copy.hintDeleting,
    hibernating: copy.hintHibernating,
    hibernated: copy.hintHibernated,
    resuming: copy.hintResuming
  }
  const hint = device !== null && device.status === 'stopped' ? healthHint(device) : null
  const hibernated = device !== null && device.status === 'hibernated'
  return (
    <Wrapper>
      {device !== null ? (
        <>
          <h3 className="title">{device.name}</h3>
          {hibernated ? (
            <>
              <p className="hibernated-icon" aria-hidden="true">
                <Moon size={22} />
              </p>
              <p className="hint">{stateHints[device.status]}</p>
              <p className="sub-hint wide">{copy.hibernatedBody}</p>
              {device.hibernationAvailable === false && device.hibernationDisabledReason ? (
                <p className="error-hint">{device.hibernationDisabledReason}</p>
              ) : null}
              <div className="hibernated-actions">
                <Button
                  variant="primary"
                  onClick={onResume}
                  disabled={device.hibernationAvailable === false}
                  title={
                    device.hibernationAvailable === false
                      ? (device.hibernationDisabledReason ?? undefined)
                      : undefined
                  }
                >
                  <span className="action-label">
                    <Play size={14} />
                    {copy.hibernatedResume}
                  </span>
                </Button>
                <Button onClick={onDiscard} title={copy.hibernatedDiscardNote}>
                  <span className="action-label">
                    <Trash2 size={14} />
                    {copy.hibernatedDiscard}
                  </span>
                </Button>
              </div>
              {device.lastError ? <p className="error-hint">{device.lastError.message}</p> : null}
            </>
          ) : (
            <>
              <p className="hint">{stateHints[device.status]}</p>
              {device.serial ? (
                <p className="sub-hint">{format(copy.serialLabel, { serial: device.serial })}</p>
              ) : null}
              {hint !== null ? (
                <>
                  <p className="error-hint">{hint}</p>
                  <Button onClick={onRecheck} disabled={rechecking}>
                    <span className="action-label">
                      <RefreshCw size={14} />
                      {copy.recheck}
                    </span>
                  </Button>
                </>
              ) : null}
              {device.lastError ? <p className="error-hint">{device.lastError.message}</p> : null}
            </>
          )}
        </>
      ) : storeState === 'error' ? (
        <>
          <h3 className="title">{copy.readFailedTitle}</h3>
          <p className="hint">{copy.readFailedHint}</p>
          <Button onClick={onRecheck} disabled={rechecking}>
            <span className="action-label">
              <RefreshCw size={14} />
              {copy.recheck}
            </span>
          </Button>
        </>
      ) : (
        <>
          <h3 className="title">{copy.emptyTitle}</h3>
          <p className="hint">{copy.emptyHint}</p>
          <Button
            variant="primary"
            onClick={onCreate}
            disabled={createDisabled}
            title={createDisabled ? copy.createDisabledTitleCanvas : undefined}
          >
            <span className="new-label">
              <Plus size={14} />
              {copy.createDevice}
            </span>
          </Button>
        </>
      )}
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  min-width: 0;
  padding: 24px;
  text-align: center;

  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--board-ink);
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--board-ink-dim);
  }

  .sub-hint {
    margin: 0 0 8px;
    font-size: 11px;
    color: var(--board-ink-dim);
    font-family: ui-monospace, monospace;
  }

  /* 已休眠占位（plan 2026-11-06 设计 F）：说明与双动作入口 */
  .hibernated-icon {
    margin: 10px 0 4px;
    color: var(--board-ink-dim);
  }

  .sub-hint.wide {
    max-width: 420px;
    font-family: inherit;
    line-height: 1.6;
  }

  .hibernated-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }

  .error-hint {
    margin: 4px 0 0;
    max-width: 420px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--board-tile-ink);
  }

  /* 两个语义名共用一条规则：动作钮与主钮的内容排布相同 */
  .action-label,
  .new-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
`

export default CanvasPlaceholder
