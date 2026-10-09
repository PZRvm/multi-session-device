import styled from 'styled-components'
import type { Device, StoreHealthState } from '@shared/types'
import DeviceRow from './DeviceRow'

type DeviceListPaneProps = {
  devices: Device[]
  selectedId: string | null
  /** 库可信（非 error）：传给 DeviceRow 的启动守卫 */
  storeTrusted: boolean
  /** 库可写（ok）：read-only 时禁改删与重命名 */
  metaWritable: boolean
  /** store error：空列表显示「读取失败」而不是「还没有设备」 */
  storeState: StoreHealthState
  /** list invoke 级失败原因（review P2-3）：与「空库」分开展示并提供重试 */
  loadError: string | null
  onRetryLoad: () => void
  onSelect: (id: string) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onCancelStart: (id: string) => void
  onCopySerial: (id: string) => void
  onDelete: (device: Device) => void
  onRename: (id: string, name: string) => void
  /** 打开配置编辑窗（运行中也可查看） */
  onEdit: (id: string) => void
  onRenameBlocked?: () => void
}

/** 左栏列表区：板头（BoardHead）与底部新建钮由 App 编排，这里只管列表本体 */
const DeviceListPane = ({
  devices,
  selectedId,
  storeTrusted,
  metaWritable,
  storeState,
  loadError,
  onRetryLoad,
  onSelect,
  onStart,
  onStop,
  onCancelStart,
  onCopySerial,
  onDelete,
  onRename,
  onEdit,
  onRenameBlocked
}: DeviceListPaneProps): React.JSX.Element => (
  <Wrapper>
    {devices.length === 0 ? (
      loadError !== null ? (
        // invoke 级失败不经过 storeHealth——按读取失败展示并保留重试（plan 差距表）
        <p className="empty-hint">
          设备列表加载失败：{loadError}
          <br />
          <button className="retry-link" onClick={onRetryLoad}>
            重试加载
          </button>
        </p>
      ) : storeState === 'error' ? (
        <p className="empty-hint">
          设备数据读取失败：devices.json 异常，修复后点上方「重新检查」重试
        </p>
      ) : storeState === 'read-only' ? (
        <p className="empty-hint">
          设备记录存在异常（如重复 id 或坏条目），暂无可显示的设备；修复 devices.json
          后点上方「重新检查」
        </p>
      ) : (
        <p className="empty-hint">还没有设备，点左下角「新建设备」创建第一台</p>
      )
    ) : (
      <div className="list">
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            selected={device.id === selectedId}
            storeTrusted={storeTrusted}
            metaWritable={metaWritable}
            onSelect={() => onSelect(device.id)}
            onStart={() => onStart(device.id)}
            onStop={() => onStop(device.id)}
            onCancelStart={() => onCancelStart(device.id)}
            onCopySerial={() => onCopySerial(device.id)}
            onDelete={() => onDelete(device)}
            onRename={(name) => onRename(device.id, name)}
            onEdit={() => onEdit(device.id)}
            onRenameBlocked={onRenameBlocked}
          />
        ))}
      </div>
    )}
  </Wrapper>
)

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--board-bg);

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;

    /* 行间发丝线（Hairline Rule） */
    & > div + div {
      border-top: 1px solid var(--board-hairline);
    }
  }

  .empty-hint {
    margin: 24px 14px;
    font-size: 12px;
    line-height: 1.7;
    color: var(--board-ink-dim);
  }

  .retry-link {
    padding: 0;
    border: none;
    background: none;
    color: var(--board-tile-ink);
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
  }

  .retry-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default DeviceListPane
