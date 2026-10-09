import { Plus, RefreshCw } from 'lucide-react'
import styled from 'styled-components'
import type { Device, StoreHealthState } from '@shared/types'
import Button from './Button'

const STATE_HINTS: Record<Device['status'], string> = {
  creating: '正在创建 AVD，完成后可启动',
  stopped: '设备已停止，从左侧列表启动它',
  starting: '正在启动模拟器，等待系统 boot 完成',
  running: '设备运行中，投屏与操控在下一步接入',
  stopping: '正在停止模拟器并回收端口',
  deleting: '正在删除 AVD 与元数据'
}

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
}

/** 健康原因展示：阻断原因优先，warning 次之 */
const healthHint = (device: Device): string | null => {
  const availability = device.availability
  if (availability === undefined || availability.state === 'valid') return null
  const hint =
    availability.issues.find((issue) => issue.severity === 'error') ?? availability.issues[0]
  return hint !== undefined ? hint.message : null
}

/** 右栏画面占位区：反映选中设备的真实状态与文件健康；运行中画面由 DeviceCanvas 接管 */
const CanvasPlaceholder = ({
  device,
  onCreate,
  onRecheck,
  storeState,
  createDisabled = false,
  rechecking = false
}: CanvasPlaceholderProps): React.JSX.Element => {
  const hint = device !== null && device.status === 'stopped' ? healthHint(device) : null
  return (
    <Wrapper>
      {device !== null ? (
        <>
          <h3 className="title">{device.name}</h3>
          <p className="hint">{STATE_HINTS[device.status]}</p>
          {device.serial ? <p className="sub-hint">serial：{device.serial}</p> : null}
          {hint !== null ? (
            <>
              <p className="error-hint">{hint}</p>
              <Button onClick={onRecheck} disabled={rechecking}>
                <span className="action-label">
                  <RefreshCw size={14} />
                  重新检查
                </span>
              </Button>
            </>
          ) : null}
          {device.lastError ? <p className="error-hint">{device.lastError.message}</p> : null}
        </>
      ) : storeState === 'error' ? (
        <>
          <h3 className="title">设备数据读取失败</h3>
          <p className="hint">devices.json 异常，应用已冻结元数据写入并保留原文件</p>
          <Button onClick={onRecheck} disabled={rechecking}>
            <span className="action-label">
              <RefreshCw size={14} />
              重新检查
            </span>
          </Button>
        </>
      ) : (
        <>
          <h3 className="title">还没有设备</h3>
          <p className="hint">三步创建一台：选画像 → 选镜像 → 命名</p>
          <Button
            variant="primary"
            onClick={onCreate}
            disabled={createDisabled}
            title={
              createDisabled ? '设备元数据写入已冻结，暂不能新建设备（详情见左侧汇总）' : undefined
            }
          >
            <span className="new-label">
              <Plus size={14} />
              新建设备
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

  .error-hint {
    margin: 4px 0 0;
    max-width: 420px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--board-tile-ink);
  }

  .action-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .new-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
`

export default CanvasPlaceholder
