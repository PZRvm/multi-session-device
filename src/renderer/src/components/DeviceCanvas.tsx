import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import styled from 'styled-components'
import type {
  Device,
  DeviceFrameKind,
  DeviceSkinPresentation,
  ScreenFormat,
  ScreenInput
} from '@shared/types'
import {
  computeLayout,
  computeSkinLayout,
  skinMaskStyle,
  type ScreenLayout
} from '../screen/geometry'
import { MAIN_COPY, format } from '@shared/i18n'
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

type DeviceCanvasProps = {
  device: Device
  onStop: () => Promise<void>
}

/** 前景必须留出可见像素；不透明的测试素材会把整个视频盖住。 */
const assertTransparentSkinMask = (image: HTMLImageElement): void => {
  const sample = document.createElement('canvas')
  sample.width = Math.min(image.naturalWidth, 64)
  sample.height = Math.min(image.naturalHeight, 64)
  const context = sample.getContext('2d')
  if (!context) throw new Error('无法检查皮肤前景遮罩透明度')
  context.drawImage(image, 0, 0, sample.width, sample.height)
  const { data } = context.getImageData(0, 0, sample.width, sample.height)
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return
  }
  throw new Error('皮肤前景遮罩完全不透明，会遮住设备画面')
}

/** 右栏画面区：主题工作台 + 设备外框 + 等比居中 canvas + 状态覆盖层 + 物理键工具条 */
const DeviceCanvas = ({ device, onStop }: DeviceCanvasProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const statusText: Record<Exclude<ScreenViewStatus, 'idle'>, string> = {
    connecting: copy.connecting,
    ready: '',
    error: copy.streamError,
    closed: copy.streamClosed
  }
  const {
    canvasRef,
    status,
    format: screenFormat,
    error,
    onGenerationChange,
    screenRef,
    retry,
    paintsRef
  } = useDeviceScreen(device)
  // 截屏状态机：设备切换/停止时气泡自动收起（hook 内 effect 守卫）
  const shot = useScreenshot(device)
  // 网络开关组（plan 2026-10-12）：态跟随 store 推送，toggle busy 至读回确认
  const net = useNetworkSwitch(device)
  const proxyRef = useRef<HTMLInputElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [inputError, setInputError] = useState<string | null>(null)
  const inputErrorTimerRef = useRef(0)
  const mountedRef = useRef(false)
  const rotatingRef = useRef(false)
  const stoppingRef = useRef(false)
  const [rotating, setRotating] = useState(false)
  const [stopping, setStopping] = useState(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      window.clearTimeout(inputErrorTimerRef.current)
    }
  }, [])
  // 布局是容器尺寸 × 视频格式 × 设备类别的纯派生，不再用 state + effect 级联
  const [skin, setSkin] = useState<DeviceSkinPresentation | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      setSkin(null)
      if (!device.advancedSettings?.skinRef) return
      try {
        const result = await window.api.sdk.deviceSkinPresentation(device.id)
        if (!result) throw new Error('已选皮肤不可用')
        const masks = new Set([result.portrait?.foregroundMask, result.landscape?.foregroundMask])
        await Promise.all(
          result.images.map(
            (asset) =>
              new Promise<void>((resolve, reject) => {
                const image = new Image()
                image.onload = () => {
                  try {
                    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
                      throw new Error('皮肤图片尺寸无效')
                    }
                    if (masks.has(asset.file)) assertTransparentSkinMask(image)
                    resolve()
                  } catch (error) {
                    reject(error)
                  }
                }
                image.onerror = () => reject(new Error(`皮肤图片损坏：${asset.file}`))
                image.src = asset.url
              })
          )
        )
        if (active) setSkin(result)
      } catch (error) {
        if (active) console.warn('[DeviceCanvas] 皮肤不可用，使用通用外框', error)
      }
    })()
    return () => {
      active = false
    }
  }, [device.id, device.advancedSettings?.skinRef])
  const frameKind: DeviceFrameKind = device.frameKind ?? 'generic'
  const layout = useMemo<ScreenLayout | null>(() => {
    if (!screenFormat || containerSize.width <= 0 || containerSize.height <= 0) return null
    if (skin) {
      const skinLayout = computeSkinLayout(
        containerSize.width,
        containerSize.height,
        screenFormat.width,
        screenFormat.height,
        skin
      )
      if (skinLayout) return skinLayout
    }
    return computeLayout(
      containerSize.width,
      containerSize.height,
      screenFormat.width,
      screenFormat.height,
      frameKind
    )
  }, [screenFormat, containerSize, frameKind, skin])
  const layoutRef = useRef<ScreenLayout | null>(null)
  // 事件回调读最新布局：ref 更新放 effect，渲染期不写 ref
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  // 首帧同步量内容区域，观察者只负责后续变化，避免已连接却仍是零尺寸。
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = (width: number, height: number): void => {
      setContainerSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      )
    }
    const rect = stage.getBoundingClientRect()
    const style = window.getComputedStyle(stage)
    const pixels = (value: string): number => Number.parseFloat(value) || 0
    update(
      Math.max(
        0,
        rect.width -
          pixels(style.borderLeftWidth) -
          pixels(style.borderRightWidth) -
          pixels(style.paddingLeft) -
          pixels(style.paddingRight)
      ),
      Math.max(
        0,
        rect.height -
          pixels(style.borderTopWidth) -
          pixels(style.borderBottomWidth) -
          pixels(style.paddingTop) -
          pixels(style.paddingBottom)
      )
    )
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
      // hook 会原地更新 generation；等待前捕获副本才能识别旧请求。
      const envelope = { ...view.envelope }
      const result = await toApiResult(
        window.api.screen.input({
          ...envelope,
          width: view.width,
          height: view.height,
          input
        })
      )
      const current = screenRef.current.envelope
      if (
        !result.ok &&
        input.kind !== 'release-all' &&
        mountedRef.current &&
        current?.deviceId === envelope.deviceId &&
        current.runId === envelope.runId &&
        current.streamId === envelope.streamId &&
        current.generation === envelope.generation &&
        current.viewToken === envelope.viewToken
      )
        showInputError(result.error)
    },
    [screenRef, showInputError]
  )

  const rotate = async (): Promise<void> => {
    if (rotatingRef.current || stoppingRef.current) return
    rotatingRef.current = true
    setRotating(true)
    try {
      await sendInput({ kind: 'rotate' })
    } finally {
      rotatingRef.current = false
      if (mountedRef.current) setRotating(false)
    }
  }

  const stop = async (): Promise<void> => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    const result = await toApiResult(onStop())
    stoppingRef.current = false
    if (mountedRef.current) {
      setStopping(false)
      if (!result.ok) showInputError(result.error)
    }
  }

  const ready = status === 'ready' && layout !== null && layout.width > 0 && layout.height > 0

  // 拖拽 APK：落在 .stage（含皮肤区），守卫与状态机在 hook，main 再校验 running/串行
  const apkInstall = useApkInstall(device.id)

  useDeviceInput({
    canvasContainerRef: stageRef,
    inputProxyRef: proxyRef,
    screenRef,
    layoutRef,
    enabled: ready && !rotating && !stopping,
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

  // dev 探针：CDP 真测读帧计数与状态（生产构建剔除）
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>)['__msdCanvas'] = {
      get paints(): number {
        return paintsRef.current
      },
      get status(): ScreenViewStatus {
        return status
      },
      get format(): ScreenFormat | null {
        return screenFormat
      }
    }
    return () => {
      delete (window as unknown as Record<string, unknown>)['__msdCanvas']
    }
  }, [status, screenFormat, paintsRef])

  return (
    <Wrapper>
      <div className="stage" ref={stageRef} onClick={focusProxy} {...apkInstall.dragHandlers}>
        {layout ? (
          /* 装饰位于视频之下；真实皮肤前景在 canvas-slot 内遮住对应像素。 */
          layout.skin && skin ? (
            <div
              className="skin-shell"
              style={{
                left: layout.frame.x,
                top: layout.frame.y,
                width: layout.frame.width,
                height: layout.frame.height
              }}
              aria-hidden="true"
            >
              <div
                style={{
                  position: 'absolute',
                  transformOrigin: '0 0',
                  transform: `${layout.skin.rotated ? `translateX(${layout.frame.width}px) rotate(90deg) ` : ''}scale(${layout.skin.artScale})`
                }}
              >
                {layout.skin.orientation.backgrounds?.map((part, index) => (
                  <img
                    key={`${part.file}-${index}`}
                    src={skin.images.find((asset) => asset.file === part.file)?.url}
                    alt=""
                    style={{
                      position: 'absolute',
                      left: part.x,
                      top: part.y,
                      maxWidth: 'none',
                      transformOrigin: '0 0',
                      transform: `rotate(${part.rotation * 90}deg)`
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
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
              {/* 听筒：手机与通用档（通用档 2026-10-13 起带装饰）；前摄只属手机——
                  通用档可能承载真机画面，视频自带前摄，画假的开孔会穿帮 */}
              {layout.frame.kind === 'phone' || layout.frame.kind === 'generic' ? (
                <div className="ear-piece" style={{ top: layout.frame.metrics.top / 2 - 2.5 }} />
              ) : null}
              {layout.frame.kind === 'phone' ? (
                <div className="front-camera" style={{ top: layout.frame.metrics.top / 2 - 2.5 }} />
              ) : null}
              {layout.frame.kind === 'tablet' ? (
                <div className="tablet-camera" style={{ top: layout.frame.metrics.top / 2 - 2 }} />
              ) : null}
              {layout.frame.kind === 'generic' ? (
                <div
                  className="home-indicator"
                  style={{ bottom: layout.frame.metrics.bottom / 2 - 2 }}
                />
              ) : null}
            </div>
          )
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
          <canvas ref={canvasRef} aria-label={format(copy.canvasAria, { name: device.name })} />
          {layout?.skin?.orientation.foregroundMask && skin ? (
            <img
              className="skin-mask"
              src={
                skin.images.find((asset) => asset.file === layout.skin!.orientation.foregroundMask)
                  ?.url
              }
              alt=""
              aria-hidden="true"
              style={skinMaskStyle(layout)}
            />
          ) : null}
        </div>
        {!ready ? (
          <div className="overlay">
            {status === 'ready' ? (
              <>
                <Loader2 size={18} className="spin" />
                <p className="overlay-text">{copy.preparing}</p>
              </>
            ) : status === 'connecting' ? (
              <>
                <Loader2 size={18} className="spin" />
                <p className="overlay-text">{statusText.connecting}</p>
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
        {/* 文本/键盘代理：画布聚焦时持有焦点，IME 组合在此发生 */}
        <input
          ref={proxyRef}
          className="proxy-input"
          aria-label={format(copy.inputAria, { name: device.name })}
          tabIndex={-1}
        />
        <InstallDropOverlay
          phase={apkInstall.phase}
          busyNote={apkInstall.busyNote}
          deviceName={device.name}
          onRetryBypass={apkInstall.retryWithBypass}
        />
      </div>
      <div className="toolbar-row">
        <DeviceToolbar
          disabled={!ready || rotating || stopping}
          powerDisabled={stopping}
          onButton={(button) => {
            void sendInput({ kind: 'button', button })
          }}
          onPower={() => {
            void stop()
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
          networkState={device.status === 'running' ? net.state : null}
          networkBusy={net.busyTarget}
          onNetworkToggle={(target) => {
            void net.toggle(target)
          }}
        />
      </div>
    </Wrapper>
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
    /* 主题工作台底（中性板面，随亮暗/主题系统切换）；canvas 黑色只留给未绘制屏幕 */
    background: var(--board-bg);
    overflow: hidden;
    outline: none;
  }

  /* 设备外壳：外圆角只作用于屏幕之外；overflow 裁掉装饰越界，屏幕是兄弟节点不受影响 */
  .skin-shell {
    position: absolute;
    pointer-events: none;
  }

  .frame-shell {
    position: absolute;
    background: var(--device-shell);
    border: 1px solid var(--device-shell-edge);
    overflow: hidden;
    pointer-events: none;
  }

  /* 手机听筒：上边框内居中的小胶囊，垂直位置随实际（含紧凑档）边距居中 */
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

  /* 手机前摄：听筒右侧小圆点 */
  .front-camera {
    position: absolute;
    left: calc(50% + 26px);
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--device-bezel-ink);
    opacity: 0.7;
  }

  /* 平板前摄：上边框居中小圆点，无听筒 */
  .tablet-camera {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--device-bezel-ink);
    opacity: 0.7;
  }

  /* 通用档底部指示条：下边框居中小胶囊（2026-10-13 用户反馈补底部装饰） */
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

  .skin-mask {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 1;
    max-width: none;
    transform-origin: 0 0;
    pointer-events: none;
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
    color: #9aa2ad;

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

  /* 文本代理：透明、1px、绝对定位在舞台内，不拦截指针 */
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

export default DeviceCanvas
