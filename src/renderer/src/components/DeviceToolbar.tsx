import {
  Camera,
  ChevronLeft,
  Home,
  Plane,
  Power,
  RotateCw,
  SignalHigh,
  SquareStack,
  Volume1,
  Volume2,
  Wifi
} from 'lucide-react'
import styled from 'styled-components'
import type { NetworkState, NetworkTarget, ScreenToolbarButton } from '@shared/types'
import { useCopy } from '../hooks/useCopy'
import { MAIN_COPY } from '@shared/i18n'
import type { ScreenshotState } from '../hooks/useScreenshot'
import ScreenshotPopover from './ScreenshotPopover'

type DeviceToolbarProps = {
  disabled: boolean
  /** 电源钮可选（真机画布不传——真机不能「停止」，电源注入闭集未开，plan 2026-10-13-real-device-toolbar-parity） */
  powerDisabled?: boolean
  onButton: (button: ScreenToolbarButton) => void
  /** 不传则不渲染电源钮（模拟器语义 = 停止设备） */
  onPower?: () => void
  onRotate: () => void
  /** 截屏（plan 2026-10-10）：走 adb，不依赖投屏流，故不受 disabled 牵连 */
  screenshotBusy: boolean
  screenshotState: ScreenshotState
  onScreenshot: () => void
  onScreenshotSave: () => void
  onScreenshotDismiss: () => void
  /** 网络开关组（plan 2026-10-12）：走 adb 独立链路，不受 disabled 牵连；
   * state 未知（设备未运行/初值未达）三开关禁用，态由 aria-pressed 承载 */
  networkState: NetworkState | null
  networkBusy: NetworkTarget | null
  onNetworkToggle: (target: NetworkTarget) => void
}

/** 物理键工具条：返回/主页/概览/电源/音量加减 + 旋转 + 截屏 + 网络开关组；本地化可访问名 + 焦点样式 + 禁用态 */
const DeviceToolbar = ({
  disabled,
  powerDisabled,
  onButton,
  onPower,
  onRotate,
  screenshotBusy,
  screenshotState,
  onScreenshot,
  onScreenshotSave,
  onScreenshotDismiss,
  networkState,
  networkBusy,
  onNetworkToggle
}: DeviceToolbarProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const buttons: Array<{
    button: ScreenToolbarButton | 'power'
    label: string
    icon: React.JSX.Element
  }> = [
    { button: 'back', label: copy.back, icon: <ChevronLeft size={16} /> },
    { button: 'home', label: copy.home, icon: <Home size={16} /> },
    { button: 'overview', label: copy.overview, icon: <SquareStack size={16} /> },
    ...(onPower
      ? [{ button: 'power' as const, label: copy.powerOff, icon: <Power size={16} /> }]
      : []),
    { button: 'volume-up', label: copy.volumeUp, icon: <Volume2 size={16} /> },
    { button: 'volume-down', label: copy.volumeDown, icon: <Volume1 size={16} /> }
  ]
  return (
    <Wrapper role="toolbar" aria-label={copy.toolbarAria}>
      {buttons.map((entry) => (
        <button
          key={entry.button}
          className="tool-btn"
          type="button"
          aria-label={entry.label}
          title={entry.label}
          disabled={entry.button === 'power' ? (powerDisabled ?? false) : disabled}
          onClick={() =>
            entry.button === 'power' ? onPower?.() : onButton(entry.button as ScreenToolbarButton)
          }
        >
          {entry.icon}
        </button>
      ))}
      <button
        className="tool-btn"
        type="button"
        aria-label={copy.rotate}
        title={copy.rotate}
        disabled={disabled}
        onClick={onRotate}
      >
        <RotateCw size={16} />
      </button>
      {/* 截屏走 adb 独立链路：busy 只由截屏进行中决定；气泡锚定在本钮上方 */}
      <div className="shot-anchor">
        <button
          className="tool-btn"
          type="button"
          aria-label={copy.screenshotAction}
          title={copy.screenshotAction}
          disabled={screenshotBusy}
          onClick={onScreenshot}
        >
          <Camera size={16} />
        </button>
        {screenshotState.phase === 'copied' ||
        screenshotState.phase === 'saving' ||
        screenshotState.phase === 'saved' ||
        screenshotState.phase === 'error' ? (
          <ScreenshotPopover
            state={screenshotState}
            onSave={onScreenshotSave}
            onClose={onScreenshotDismiss}
          />
        ) : null}
      </div>
      {/* 网络开关组：断网总开关（飞行模式，真断网）+ Wi-Fi/移动数据分 radio（场景测试）；
          态以设备读回为唯一事实源，aria-pressed 承载开闭，busy/未知态禁用 */}
      <div className="net-group" role="group" aria-label={copy.networkGroupAria}>
        <button
          className="tool-btn net-toggle net-airplane"
          type="button"
          aria-label={copy.networkAirplaneToggle}
          title={copy.networkAirplaneToggle}
          aria-pressed={networkState ? networkState.airplane : undefined}
          disabled={networkState === null || networkBusy !== null}
          onClick={() => onNetworkToggle('airplane')}
        >
          <Plane size={16} />
        </button>
        <button
          className="tool-btn net-toggle"
          type="button"
          aria-label={copy.networkWifiToggle}
          title={copy.networkWifiToggle}
          aria-pressed={networkState ? networkState.wifi : undefined}
          disabled={networkState === null || networkBusy !== null}
          onClick={() => onNetworkToggle('wifi')}
        >
          <Wifi size={16} />
        </button>
        <button
          className="tool-btn net-toggle"
          type="button"
          aria-label={copy.networkDataToggle}
          title={copy.networkDataToggle}
          aria-pressed={networkState ? networkState.data : undefined}
          disabled={networkState === null || networkBusy !== null}
          onClick={() => onNetworkToggle('data')}
        >
          <SignalHigh size={16} />
        </button>
      </div>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--board-bg-raised);
  border: 1px solid var(--board-hairline);

  .shot-anchor {
    position: relative;
    display: flex;
  }

  .net-group {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    padding-left: 6px;
    border-left: 1px solid var(--board-hairline);
  }

  /* 开启态：radio 开关用主题色强调；断网总开关开启 = 离线，用危险色 */
  .net-toggle[aria-pressed='true'] {
    background: var(--board-hover-veil);
    color: var(--accent);
  }

  .net-airplane[aria-pressed='true'] {
    color: var(--danger);
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--board-ink);
    cursor: pointer;
    transition: background-color 0.12s;
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tool-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default DeviceToolbar
