import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw, Smartphone } from 'lucide-react'
import styled from 'styled-components'
import type { ExternalDevice, ScreenInput } from '@shared/types'
import { computeLayout, type ScreenLayout } from '../screen/geometry'
import { MAIN_COPY } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import { useApkInstall } from '../hooks/useApkInstall'
import { useDeviceInput } from '../hooks/useDeviceInput'
import { useDeviceScreen, type ScreenViewStatus } from '../hooks/useDeviceScreen'
import { useScreenshot } from '../hooks/useScreenshot'
import { useNetworkSwitch } from '../hooks/useNetworkSwitch'
import { spinKeyframes } from '../styles/animations'
import { toApiResult } from '../api'
import DeviceToolbar from './DeviceToolbar'
import InstallDropOverlay from './InstallDropOverlay'

type ExternalCanvasProps = {
  device: ExternalDevice
}

/** 真机画布（plan 2026-10-13-real-device-usb-and-apk-install）：复用投屏渲染/输入/旋转与
 *  拖拽安装链路；无电源（断开 = 拔线，设备不是应用所有物）、无截屏/网络/日志
 *  （三域对真机的适配在 PRD 后续批次，假设 5）。外框沿用 generic 档的通用机身。 */
const ExternalCanvas = ({ device }: ExternalCanvasProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const statusText: Record<Exclude<ScreenViewStatus, 'idle'>, string> = {
    connecting: copy.connecting,
    ready: '',
    error: copy.streamError,
    closed: copy.streamClosed
  }
  // 投屏 hook 吃最小目标形态：真机 connected 等价 running；runId 由 main 会话代次持有
  const screen = useDeviceScreen(
    device.state === 'device' ? { id: device.id, status: 'running' as const } : null
  )
  const {
    canvasRef,
    status,
    format: screenFormat,
    error,
    onGenerationChange,
    screenRef,
    retry
  } = screen
  const proxyRef = useRef<HTMLInputElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [inputError, setInputError] = useState<string | null>(null)
  const inputErrorTimerRef = useRef(0)
  const mountedRef = useRef(false)
  const rotatingRef = useRef(false)
  const [rotating, setRotating] = useState(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      window.clearTimeout(inputErrorTimerRef.current)
    }
  }, [])
  const layout = useMemo<ScreenLayout | null>(() => {
    if (!screenFormat || containerSize.width <= 0 || containerSize.height <= 0) return null
    return computeLayout(
      containerSize.width,
      containerSize.height,
      screenFormat.width,
      screenFormat.height,
      'generic'
    )
  }, [screenFormat, containerSize])
  const layoutRef = useRef<ScreenLayout | null>(null)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = (width: number, height: number): void => {
      setContainerSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      )
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      update(rect.width, rect.height)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const focusProxy = useCallback((): void => {
    proxyRef.current?.focus()
  }, [])

  const showInputError = useCallback((message: string): void => {
    setInputError(message)
    window.clearTimeout(inputErrorTimerRef.current)
    inputErrorTimerRef.current = window.setTimeout(() => setInputError(null), 4_000)
  }, [])

  const sendInput = useCallback(
    async (input: ScreenInput): Promise<void> => {
      const view = screenRef.current
      if (!view.envelope) return
      const envelope = { ...view.envelope }
      const result = await toApiResult(
        window.api.screen.input({
          ...envelope,
          width: view.width,
          height: view.height,
          input
        })
      )
      if (!result.ok && input.kind !== 'release-all' && mountedRef.current)
        showInputError(result.error)
    },
    [screenRef, showInputError]
  )

  const rotate = async (): Promise<void> => {
    if (rotatingRef.current) return
    rotatingRef.current = true
    setRotating(true)
    try {
      await sendInput({ kind: 'rotate' })
    } finally {
      rotatingRef.current = false
      if (mountedRef.current) setRotating(false)
    }
  }

  const ready = status === 'ready' && layout !== null && layout.width > 0 && layout.height > 0

  // 拖拽安装与 AVD 画布同一 hook（id = serial，main 侧组合查询出 serial）
  const apkInstall = useApkInstall(device.id)

  // 截屏（S3）：adb 链路与设备来源无关；status 适配——connected ≡ running，
  // 失联时气泡随渲染期派生收起（同模拟器停止语义）
  const shot = useScreenshot({
    id: device.id,
    status: device.state === 'device' ? 'running' : 'stopped'
  })

  // 网络开关组（S4）：adb 链路 + external 桥挂的 1s 轮询；态经 useNetworkSwitch 双源合并读
  const net = useNetworkSwitch({ id: device.id })

  useDeviceInput({
    canvasContainerRef: stageRef,
    inputProxyRef: proxyRef,
    screenRef,
    layoutRef,
    enabled: ready && !rotating,
    onInputError: showInputError
  })

  // 旋转：main 先释放输入；renderer 释放本地手势并等新尺寸
  useEffect(
    () =>
      onGenerationChange(() => {
        void sendInput({ kind: 'release-all' })
      }),
    [onGenerationChange, sendInput]
  )

  return (
    <Wrapper>
      <div className="stage" ref={stageRef} onClick={focusProxy} {...apkInstall.dragHandlers}>
        {/* 通用外框（用户 2026-10-13 批复）：generic 档圆角机身 + 顶部听筒/底部指示条
            （与 DeviceCanvas 通用档同规则）；不画前摄开孔——真机视频自带前摄，画假的
            会穿帮；装饰位于视频之下（与 DeviceCanvas 同序） */}
        {layout ? (
          <div
            className="frame-shell"
            aria-hidden="true"
            style={{
              left: layout.frame.x,
              top: layout.frame.y,
              width: layout.frame.width,
              height: layout.frame.height,
              borderRadius: layout.frame.radius
            }}
          >
            <div className="ear-piece" style={{ top: layout.frame.metrics.top / 2 - 2.5 }} />
            <div
              className="home-indicator"
              style={{ bottom: layout.frame.metrics.bottom / 2 - 2 }}
            />
          </div>
        ) : null}
        <div
          className="canvas-slot"
          style={{
            left: layout ? layout.offsetX : 0,
            top: layout ? layout.offsetY : 0,
            width: layout ? layout.width : 0,
            height: layout ? layout.height : 0
          }}
        >
          <canvas ref={canvasRef} aria-label={device.model ?? device.serial} />
        </div>
        {!ready ? (
          <div className="overlay">
            {status === 'connecting' || (status === 'ready' && layout === null) ? (
              <>
                <Loader2 size={18} className="spin" />
                <p className="overlay-text">
                  {status === 'connecting' ? statusText.connecting : copy.preparing}
                </p>
              </>
            ) : status === 'error' ? (
              <>
                <p className="overlay-text">{statusText.error}</p>
                {error ? <p className="overlay-hint">{error}</p> : null}
                <button type="button" className="retry-button" onClick={retry}>
                  <RotateCcw size={13} />
                  {copy.retryConnect}
                </button>
              </>
            ) : status === 'closed' ? (
              <p className="overlay-text">{statusText.closed}</p>
            ) : null}
          </div>
        ) : null}
        {inputError ? (
          <p className="input-error" role="alert">
            {inputError}
          </p>
        ) : null}
        <input
          ref={proxyRef}
          className="proxy-input"
          aria-label={device.model ?? device.serial}
          tabIndex={-1}
        />
        <InstallDropOverlay
          phase={apkInstall.phase}
          busyNote={apkInstall.busyNote}
          deviceName={device.model ?? device.serial}
          onRetryBypass={apkInstall.retryWithBypass}
        />
      </div>
      <div className="toolbar-row">
        {/* 完整工具条：六键 + 旋转 + 截屏组；网络组在 S4 接真实现；电源钮不传——
            真机不能「停止」，电源注入闭集未开（用户裁定不做） */}
        <DeviceToolbar
          disabled={!ready || rotating}
          onButton={(button) => {
            void sendInput({ kind: 'button', button })
          }}
          onRotate={() => {
            void rotate()
          }}
          screenshotBusy={shot.busy}
          screenshotState={shot.state}
          onScreenshot={() => {
            void shot.capture()
          }}
          onScreenshotSave={() => {
            void shot.save()
          }}
          onScreenshotDismiss={shot.dismiss}
          networkState={device.state === 'device' ? net.state : null}
          networkBusy={net.busyTarget}
          onNetworkToggle={(target) => {
            void net.toggle(target)
          }}
        />
      </div>
    </Wrapper>
  )
}

/** 真机未就绪占位（unauthorized/offline）：引导行与列表同文案，不渲染投屏链路 */
export const ExternalCanvasPlaceholder = ({
  device
}: {
  device: ExternalDevice
}): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const hint =
    device.state === 'unauthorized' ? copy.realDeviceUnauthorizedHint : copy.realDeviceOfflineHint
  return (
    <Placeholder>
      <Smartphone size={28} aria-hidden="true" />
      <p className="title">{device.model ?? device.serial}</p>
      <p className="hint">{hint}</p>
    </Placeholder>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 16px 16px 12px;

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: var(--board-bg);
    overflow: hidden;
    outline: none;
  }

  /* 通用外框：圆角机身只包屏幕之外（与 DeviceCanvas 同规则，generic 档带听筒/指示条） */
  .frame-shell {
    position: absolute;
    background: var(--device-shell);
    border: 1px solid var(--device-shell-edge);
    overflow: hidden;
    pointer-events: none;
  }

  .ear-piece {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 5px;
    border-radius: 3px;
    background: var(--device-bezel-ink);
    opacity: 0.55;
  }

  .home-indicator {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--device-bezel-ink);
    opacity: 0.55;
  }

  .canvas-slot {
    position: absolute;

    & > canvas {
      width: 100%;
      height: 100%;
      display: block;
      background: #000;
      cursor: default;
    }
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--board-ink-dim);

    .spin {
      animation: ${spinKeyframes} 1.2s linear infinite;
    }
  }

  .overlay-text {
    margin: 0;
    font-size: 13px;
  }

  .overlay-hint {
    margin: 0;
    max-width: 360px;
    font-size: 11px;
    line-height: 1.5;
    word-break: break-all;
  }

  .retry-button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--board-control-line);
    border-radius: 6px;
    background: var(--board-bg);
    color: var(--board-ink);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      background: var(--board-bg-raised);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
  }

  .input-error {
    position: absolute;
    bottom: 10px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    max-width: 80%;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--board-bg-raised);
    border: 1px solid var(--board-hairline);
    color: var(--board-tile-ink);
    font-size: 11px;
  }

  .proxy-input {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    border: none;
    padding: 0;
    pointer-events: none;
  }

  .toolbar-row {
    flex: none;
  }
`

const Placeholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 24px;
  color: var(--board-ink-dim);

  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--board-ink);
  }

  .hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    text-align: center;
  }
`

export default ExternalCanvas
