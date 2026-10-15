import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Usb, Wifi } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type {
  Device,
  ExternalDevice,
  StoreHealthState,
  WirelessConnectOutcome
} from '@shared/types'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'
import { spinKeyframes } from '../styles/animations'
import DeviceRow from './DeviceRow'
import { wirelessConnectFailureText } from './wirelessOutcome'
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

/** 转无线反馈（行内呈现）：working 进行中 / done 成功待拔线 / fail 带原因文案 */
type PromoteState =
  | { serial: string; phase: 'working' }
  | { serial: string; phase: 'done' }
  | { serial: string; phase: 'fail'; text: string }

/** 真机行（plan 2026-10-13-real-device-usb-and-apk-install）：复用 AVD 行的视觉语言——
 *  三行结构（标题 + 角标 / 状态点 + 元信息 / 引导行），点击行即选中投屏。无线批
 *  （plan 2026-10-15-real-device-wireless）加行内动作：USB 行「转为无线」、无线行「断开」 */
const ExternalRow = ({
  device,
  selected,
  onSelect,
  promoteState,
  onPromote,
  onDisconnect
}: {
  device: ExternalDevice
  selected: boolean
  onSelect: () => void
  promoteState?: PromoteState
  onPromote?: (serial: string) => void
  onDisconnect?: (serial: string) => void
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
        {device.state === 'device' && device.transport === 'usb' && onPromote ? (
          <button
            type="button"
            className="row-action"
            disabled={promoteState?.phase === 'working'}
            onClick={(event) => {
              event.stopPropagation()
              onPromote(device.serial)
            }}
          >
            {promoteState?.phase === 'working' ? (
              <Loader2 size={11} className="row-action-spin" aria-hidden="true" />
            ) : (
              copy.wirelessPromote
            )}
          </button>
        ) : null}
        {device.state === 'device' && device.transport === 'wireless' && onDisconnect ? (
          <button
            type="button"
            className="row-action danger"
            onClick={(event) => {
              event.stopPropagation()
              onDisconnect(device.serial)
            }}
          >
            {copy.wirelessDisconnect}
          </button>
        ) : null}
        {/* 无线 offline 是死条目（连上过即被 adb server 记住，失联后永远挂在列表）：
            允许删除——adb disconnect 摘掉 transport，track 下一帧即消失（用户
            2026-10-15 需求，TUN 幽灵条目教训）。USB offline 插拔即愈，不给按钮 */}
        {device.state === 'offline' && device.transport === 'wireless' && onDisconnect ? (
          <button
            type="button"
            className="row-action danger"
            onClick={(event) => {
              event.stopPropagation()
              onDisconnect(device.serial)
            }}
          >
            {copy.wirelessDelete}
          </button>
        ) : null}
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
        <span className="row-hint">
          {device.transport === 'wireless'
            ? copy.realDeviceOfflineWirelessHint
            : copy.realDeviceOfflineHint}
        </span>
      ) : promoteState?.phase === 'done' && promoteState.serial === device.serial ? (
        <span className="row-hint promote-done">{copy.wirelessPromoteDone}</span>
      ) : promoteState?.phase === 'fail' && promoteState.serial === device.serial ? (
        <span className="row-hint promote-fail">{promoteState.text}</span>
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
  // 无线批（plan 2026-10-15-real-device-wireless）：连接器已改 mac 原生弹窗（用户裁定，
  // 渲染层弹层与窗口几何打架）——这里只发起开窗；转无线反馈是行内瞬态，不进 store
  // （无状态裁定：刷新即丢，设备由 track 推送呈现）
  const [promote, setPromote] = useState<PromoteState | null>(null)
  // 断开/删除失败反馈（P3-3）：serial → 文案（map——P3-10：多台先后失败并存不覆盖）
  const [disconnectErrors, setDisconnectErrors] = useState<Record<string, string>>({})
  const { active, folded } = splitByOriginView(devices, sourceBucket)
  // 自清定时器登记（P3-9）：卸载统一清理（对齐 inputErrorTimerRef 先例）
  const timersRef = useRef(new Set<number>())
  useEffect(
    () => () => {
      for (const id of timersRef.current) window.clearTimeout(id)
    },
    []
  )
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id)
      fn()
    }, ms)
    timersRef.current.add(id)
  }
  // 反馈只在设备在场时呈现（渲染期派生，不用 effect 清账）：拔线后行不在即不显示
  const activePromote =
    promote && externalDevices.some((device) => device.serial === promote.serial) ? promote : null

  const handlePromote = (serial: string): void => {
    setPromote({ serial, phase: 'working' })
    void toApiResult(window.api.devices.promoteExternalWireless({ serial })).then((result) => {
      if (!result.ok) {
        setPromote({ serial, phase: 'fail', text: result.error })
        return
      }
      const outcome: WirelessConnectOutcome = result.data
      setPromote(
        outcome.ok
          ? { serial, phase: 'done' }
          : { serial, phase: 'fail', text: wirelessConnectFailureText(copy, outcome) }
      )
      // done 提示 6 秒后自清（P3-4：重插同 serial 不重显旧提示）；失败态不自动清，
      // 随设备离场消失（派生收口）
      if (outcome.ok) {
        later(
          () => setPromote((cur) => (cur?.serial === serial && cur.phase === 'done' ? null : cur)),
          6_000
        )
      }
    })
  }

  const handleDisconnect = (serial: string): void => {
    void toApiResult(window.api.devices.disconnectExternal(serial)).then((result) => {
      if (!result.ok) {
        // P3-3：断开/删除失败不再全静默——行内一句，8 秒自清或随离场消失
        setDisconnectErrors((cur) => ({ ...cur, [serial]: result.error }))
        later(
          () =>
            setDisconnectErrors((cur) => {
              const rest = { ...cur }
              delete rest[serial]
              return rest
            }),
          8_000
        )
      }
    })
  }

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
          <div className="real-head">
            <button
              type="button"
              className="folded-toggle real-toggle"
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
            <button
              type="button"
              className="real-wireless-btn"
              aria-label={copy.wirelessConnectAria}
              title={copy.wirelessConnectAria}
              onClick={() => void toApiResult(window.api.devices.openExternalWireless())}
            >
              <Wifi size={12} aria-hidden="true" />
            </button>
          </div>
          {realOpen ? (
            <div className="real-body">
              {externalDevices.length === 0 ? (
                <p className="real-empty">
                  {copy.realDeviceEmpty}
                  <button
                    type="button"
                    className="real-empty-action"
                    onClick={() => void toApiResult(window.api.devices.openExternalWireless())}
                  >
                    {copy.wirelessConnectEmpty}
                  </button>
                </p>
              ) : (
                externalDevices.map((device) => {
                  const disconnectErrorText = disconnectErrors[device.serial]
                  const rowFeedback =
                    activePromote?.serial === device.serial
                      ? activePromote
                      : disconnectErrorText !== undefined
                        ? {
                            serial: device.serial,
                            phase: 'fail' as const,
                            text: disconnectErrorText
                          }
                        : undefined
                  return (
                    <ExternalRow
                      key={device.id}
                      device={device}
                      selected={device.id === selectedExternalId}
                      onSelect={() => onSelectExternal(device.id)}
                      promoteState={rowFeedback}
                      onPromote={handlePromote}
                      onDisconnect={handleDisconnect}
                    />
                  )
                })
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
     紧跟 AVD 分区（或空库提示）之后，不钉在栏底（用户 2026-10-13 反馈）。
     无线批（2026-10-15）：组头拆成容器行（按钮嵌按钮不合法）+ 右侧常驻无线入口；
     弹层锚在本区（position: relative） */
  .real-devices {
    position: relative;
    border-top: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);
  }

  .real-head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 6px;
  }

  .real-toggle {
    flex: 1;
    min-width: 0;
  }

  .real-wireless-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink-dim);
    cursor: pointer;
    transition:
      background-color 0.12s,
      color 0.12s;
  }

  .real-wireless-btn:hover {
    background: var(--board-hover-veil);
    color: var(--board-ink);
  }

  .real-wireless-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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

  .real-empty-action {
    display: inline-block;
    margin-left: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--board-tile-ink);
    font-size: 11px;
    font-family: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  .real-empty-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--board-control-line);
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink-dim);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition:
      background-color 0.12s,
      color 0.12s,
      border-color 0.12s;
  }

  .row-action:hover:not(:disabled) {
    background: var(--board-hover-veil);
    color: var(--board-ink);
    border-color: var(--board-ink-dim);
  }

  .row-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .row-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* 断开/删除是破坏性动作：红字红边，hover 红混底（对齐 net-airplane 的 danger 惯用式） */
  .row-action.danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, var(--board-control-line));
  }

  .row-action.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 18%, var(--board-bg));
    color: var(--danger);
    border-color: var(--danger);
  }

  .row-action-spin {
    animation: ${spinKeyframes} 0.9s linear infinite;
  }

  .promote-done {
    color: var(--board-tile-ink);
  }

  .promote-fail {
    color: var(--danger);
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
    gap: 6px;
  }

  /* 标题吃满余宽：行内动作钮与传输角标一起贴右（用户 2026-10-15 反馈：断开钮要贴
     最右侧 Wi-Fi 图标左边，不悬在中间） */
  .row-title {
    flex: 1;
    min-width: 0;
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
