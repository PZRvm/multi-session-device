import { useState } from 'react'
import { ChevronDown, ChevronRight, Usb, Wifi } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { Device, ExternalDevice, StoreHealthState } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import DeviceRow from './DeviceRow'
import { splitByOriginView, originOf, type SourceBucket } from './originView'

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
  /** 真机区（plan 2026-10-13-real-device-usb-and-apk-install）：main 推送的物理设备 */
  externalDevices: ExternalDevice[]
  selectedExternalId: string | null
  onSelectExternal: (id: string) => void
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
  /** 跨来源桶设备尝试修改（重命名路径）时的反馈入口（用户复核 5） */
  onCrossBucketBlocked?: () => void
}

const rowHandlers = (
  device: Device,
  shared: Pick<
    DeviceListPaneProps,
    | 'selectedId'
    | 'storeTrusted'
    | 'metaWritable'
    | 'sourceBucket'
    | 'onSelect'
    | 'onStart'
    | 'onStop'
    | 'onCancelStart'
    | 'onCopySerial'
    | 'onDelete'
    | 'onRename'
    | 'onEdit'
    | 'onRenameBlocked'
    | 'onCrossBucketBlocked'
  >
): React.JSX.Element => (
  <DeviceRow
    key={device.id}
    device={device}
    selected={device.id === shared.selectedId}
    storeTrusted={shared.storeTrusted}
    metaWritable={shared.metaWritable}
    crossBucket={originOf(device) !== shared.sourceBucket}
    onSelect={() => shared.onSelect(device.id)}
    onStart={() => shared.onStart(device.id)}
    onStop={() => shared.onStop(device.id)}
    onCancelStart={() => shared.onCancelStart(device.id)}
    onCopySerial={() => shared.onCopySerial(device.id)}
    onDelete={() => shared.onDelete(device)}
    onRename={(name) => shared.onRename(device.id, name)}
    onEdit={() => shared.onEdit(device.id)}
    onRenameBlocked={shared.onRenameBlocked}
    onCrossBucketBlocked={shared.onCrossBucketBlocked}
  />
)

/** 真机行（plan 2026-10-13-real-device-usb-and-apk-install）：复用 AVD 行的视觉语言——
 *  三行结构（标题 + 角标 / 状态点 + 元信息 / 引导行），无内联操作（点击行即选中投屏） */
const ExternalRow = ({
  device,
  selected,
  onSelect
}: {
  device: ExternalDevice
  selected: boolean
  onSelect: () => void
}): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const stateText =
    device.state === 'device'
      ? copy.realDeviceOnline
      : device.state === 'unauthorized'
        ? copy.realDeviceUnauthorized
        : copy.realDeviceOffline
  const title = device.model ?? device.serial
  const meta = device.model !== null ? `${device.serial} · ${stateText}` : stateText
  return (
    <div
      role="button"
      tabIndex={0}
      className="external-row"
      aria-current={selected || undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="row-head">
        <span className="row-title">{title}</span>
        <span
          className="transport"
          role="img"
          aria-label={
            device.transport === 'usb' ? copy.usbTransportAria : copy.wirelessTransportAria
          }
        >
          {device.transport === 'usb' ? (
            <Usb size={13} aria-hidden="true" />
          ) : (
            <Wifi size={13} aria-hidden="true" />
          )}
        </span>
      </span>
      <span className="row-meta">
        <span className={`state-dot ${device.state}`} aria-hidden="true" />
        {meta}
      </span>
      {device.state === 'unauthorized' ? (
        <span className="row-hint">{copy.realDeviceUnauthorizedHint}</span>
      ) : device.state === 'offline' ? (
        <span className="row-hint">{copy.realDeviceOfflineHint}</span>
      ) : null}
    </div>
  )
}

/** 左栏列表区：板头（BoardHead）与底部新建钮由 App 编排，这里只管列表本体。
 * 出身过滤视图（plan 2026-10-12-device-list-origin-view-filter）：默认只平铺
 * 当前来源桶出身的设备（过渡态豁免），另一桶收进底部折叠区——展开后也以独立
 * 分区呈现，不与主列表混排（用户批复「两边尽量隔离」）。真机区常驻底部
 * （plan 2026-10-13-real-device-usb-and-apk-install），组头样式同折叠组。 */
const DeviceListPane = ({
  devices,
  selectedId,
  storeTrusted,
  metaWritable,
  storeState,
  sourceBucket,
  loadError,
  externalDevices,
  selectedExternalId,
  onSelectExternal,
  onRetryLoad,
  onSelect,
  onStart,
  onStop,
  onCancelStart,
  onCopySerial,
  onDelete,
  onRename,
  onEdit,
  onRenameBlocked,
  onCrossBucketBlocked
}: DeviceListPaneProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const [foldedOpen, setFoldedOpen] = useState(false)
  const [realOpen, setRealOpen] = useState(true)
  const { active, folded } = splitByOriginView(devices, sourceBucket)
  const foldedLine =
    folded.length > 0
      ? format(sourceBucket === 'shared-studio' ? copy.otherOriginOwned : copy.otherOriginStudio, {
          count: folded.length
        })
      : null

  return (
    <Wrapper>
      {/* 单一滚动容器：AVD 分区（或空库提示）之后紧跟真机区——不钉在栏底（用户
          2026-10-13 反馈：真机列表要贴上方列表下方） */}
      <div className="list">
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
          <>
            <div className="origin-main">
              {active.map((device) =>
                rowHandlers(device, {
                  selectedId,
                  storeTrusted,
                  metaWritable,
                  sourceBucket,
                  onSelect,
                  onStart,
                  onStop,
                  onCancelStart,
                  onCopySerial,
                  onDelete,
                  onRename,
                  onEdit,
                  onRenameBlocked,
                  onCrossBucketBlocked
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
                        sourceBucket,
                        onSelect,
                        onStart,
                        onStop,
                        onCancelStart,
                        onCopySerial,
                        onDelete,
                        onRename,
                        onEdit,
                        onRenameBlocked,
                        onCrossBucketBlocked
                      })
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <div className="real-devices">
          <button
            type="button"
            className="folded-toggle"
            aria-expanded={realOpen}
            onClick={() => setRealOpen((open) => !open)}
          >
            {realOpen ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
            {format(copy.realDeviceSectionCount, { count: externalDevices.length })}
          </button>
          {realOpen ? (
            <div className="real-body">
              {externalDevices.length === 0 ? (
                <p className="real-empty">{copy.realDeviceEmpty}</p>
              ) : (
                externalDevices.map((device) => (
                  <ExternalRow
                    key={device.id}
                    device={device}
                    selected={device.id === selectedExternalId}
                    onSelect={() => onSelectExternal(device.id)}
                  />
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
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

  /* 真机区（plan 2026-10-13-real-device-usb-and-apk-install）：组头同折叠组样式，
     行卡复用 AVD 行的视觉语言（发丝线分隔、选中 accent 底）。位于滚动列表流内——
     紧跟 AVD 分区（或空库提示）之后，不钉在栏底（用户 2026-10-13 反馈） */
  .real-devices {
    border-top: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);
  }

  .real-body {
    display: flex;
    flex-direction: column;
  }

  .real-body > * + * {
    border-top: 1px solid var(--board-hairline);
  }

  .real-empty {
    margin: 0;
    padding: 8px 12px 10px;
    font-size: 11px;
    line-height: 1.7;
    color: var(--board-ink-dim);
  }

  .external-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px 9px;
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

    &[aria-current] .row-meta,
    &[aria-current] .row-hint {
      color: inherit;
      opacity: 0.8;
    }

    &[aria-current] .state-dot {
      background: var(--accent-ink);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
  }

  .row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .row-title {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .transport {
    display: inline-flex;
    flex: none;
    color: var(--board-ink-dim);
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--board-ink-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--idle);
  }

  .state-dot.device {
    background: var(--loading);
  }

  .state-dot.unauthorized {
    background: var(--danger);
  }

  .row-hint {
    font-size: 11px;
    line-height: 1.6;
    color: var(--board-tile-ink);
  }
`

export default DeviceListPane
