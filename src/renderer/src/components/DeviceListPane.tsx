import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { Device, StoreHealthState } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import DeviceRow from './DeviceRow'
import { splitByOriginView, type SourceBucket } from './originView'

type DeviceListPaneProps = {
  devices: Device[]
  selectedId: string | null
  /** 库可信（非 error）：传给 DeviceRow 的启动守卫 */
  storeTrusted: boolean
  /** 库可写（ok）：read-only 时禁改删与重命名 */
  metaWritable: boolean
  /** store error：空列表显示「读取失败」而不是「还没有设备」 */
  storeState: StoreHealthState
  /** 活动来源桶（出身过滤视图谓词依赖，plan 2026-10-12-device-list-origin-view-filter） */
  sourceBucket: SourceBucket
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

const rowHandlers = (
  device: Device,
  shared: Pick<
    DeviceListPaneProps,
    | 'selectedId'
    | 'storeTrusted'
    | 'metaWritable'
    | 'onSelect'
    | 'onStart'
    | 'onStop'
    | 'onCancelStart'
    | 'onCopySerial'
    | 'onDelete'
    | 'onRename'
    | 'onEdit'
    | 'onRenameBlocked'
  >
): React.JSX.Element => (
  <DeviceRow
    key={device.id}
    device={device}
    selected={device.id === shared.selectedId}
    storeTrusted={shared.storeTrusted}
    metaWritable={shared.metaWritable}
    onSelect={() => shared.onSelect(device.id)}
    onStart={() => shared.onStart(device.id)}
    onStop={() => shared.onStop(device.id)}
    onCancelStart={() => shared.onCancelStart(device.id)}
    onCopySerial={() => shared.onCopySerial(device.id)}
    onDelete={() => shared.onDelete(device)}
    onRename={(name) => shared.onRename(device.id, name)}
    onEdit={() => shared.onEdit(device.id)}
    onRenameBlocked={shared.onRenameBlocked}
  />
)

/** 左栏列表区：板头（BoardHead）与底部新建钮由 App 编排，这里只管列表本体。
 * 出身过滤视图（plan 2026-10-12-device-list-origin-view-filter）：默认只平铺
 * 当前来源桶出身的设备（过渡态豁免），另一桶收进底部折叠区——展开后也以独立
 * 分区呈现，不与主列表混排（用户批复「两边尽量隔离」）。 */
const DeviceListPane = ({
  devices,
  selectedId,
  storeTrusted,
  metaWritable,
  storeState,
  sourceBucket,
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
}: DeviceListPaneProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const [foldedOpen, setFoldedOpen] = useState(false)
  const { active, folded } = splitByOriginView(devices, sourceBucket)
  const foldedLine =
    folded.length > 0
      ? format(sourceBucket === 'shared-studio' ? copy.otherOriginOwned : copy.otherOriginStudio, {
          count: folded.length
        })
      : null

  return (
    <Wrapper>
      {devices.length === 0 ? (
        loadError !== null ? (
          // invoke 级失败不经过 storeHealth——按读取失败展示并保留重试（plan 差距表）
          <p className="empty-hint">
            {format(copy.loadFailed, { message: loadError })}
            <br />
            <button type="button" className="retry-link" onClick={onRetryLoad}>
              {copy.retryLoad}
            </button>
          </p>
        ) : storeState === 'error' ? (
          <p className="empty-hint">{copy.listReadFailed}</p>
        ) : storeState === 'read-only' ? (
          <p className="empty-hint">{copy.readOnlyEmpty}</p>
        ) : (
          <p className="empty-hint">{copy.emptyList}</p>
        )
      ) : (
        <div className="list">
          <div className="origin-main">
            {active.map((device) =>
              rowHandlers(device, {
                selectedId,
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
              })
            )}
          </div>
          {foldedLine !== null ? (
            <div className="origin-folded">
              <button
                type="button"
                className="folded-toggle"
                aria-expanded={foldedOpen}
                onClick={() => setFoldedOpen((open) => !open)}
              >
                {foldedOpen ? (
                  <ChevronDown size={12} aria-hidden="true" />
                ) : (
                  <ChevronRight size={12} aria-hidden="true" />
                )}
                {foldedLine}
              </button>
              {foldedOpen ? (
                <div className="origin-folded-body">
                  {folded.map((device) =>
                    rowHandlers(device, {
                      selectedId,
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
                    })
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Wrapper>
  )
}

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
    min-height: 0;
  }

  /* 出身过滤视图：主分区与折叠分区各自独立（展开不混排，用户批复「两边尽量隔离」） */
  .origin-main,
  .origin-folded-body {
    display: flex;
    flex-direction: column;
  }

  .origin-folded {
    border-top: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);
  }

  .folded-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 7px 12px;
    border: none;
    background: none;
    color: var(--board-ink-dim);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .folded-toggle:hover {
    color: var(--board-tile-ink);
  }

  .folded-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* 相邻行间发丝线沿用主列表规则；分区之间由折叠区背景色与分区线区隔 */
  .origin-main > * + *,
  .origin-folded-body > * + * {
    border-top: 1px solid var(--board-hairline);
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
