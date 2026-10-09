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
  type FrameRect,
  type ScreenLayout
} from '../screen/geometry'
import { useDeviceInput } from '../hooks/useDeviceInput'
import { useDeviceScreen, type ScreenViewStatus } from '../hooks/useDeviceScreen'
import { toApiResult } from '../api'
import DeviceToolbar from './DeviceToolbar'

const STATUS_TEXT: Record<Exclude<ScreenViewStatus, 'idle'>, string> = {
  connecting: '连接设备画面…',
  ready: '',
  error: '画面连接失败',
  closed: '画面已关闭'
}

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
  const { canvasRef, status, format, error, onGenerationChange, screenRef, retry, paintsRef } =
    useDeviceScreen(device)
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
    if (!format || containerSize.width <= 0 || containerSize.height <= 0) return null
    if (skin) {
      const skinLayout = computeSkinLayout(
        containerSize.width,
        containerSize.height,
        format.width,
        format.height,
        skin
      )
      if (skinLayout) return skinLayout
    }
    return computeLayout(
      containerSize.width,
      containerSize.height,
      format.width,
      format.height,
      frameKind
    )
  }, [format, containerSize, frameKind, skin])
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
        return format
      }
    }
    return () => {
      delete (window as unknown as Record<string, unknown>)['__msdCanvas']
    }
  }, [status, format, paintsRef])

  return (
    <Wrapper>
      <Stage ref={stageRef} onClick={focusProxy}>
        {layout ? (
          /* 装饰位于视频之下；真实皮肤前景在 CanvasSlot 内遮住对应像素。 */
          layout.skin && skin ? (
            <SkinShell
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
            </SkinShell>
          ) : (
            <FrameShell $frame={layout.frame} aria-hidden="true">
              {layout.frame.kind === 'phone' ? (
                <>
                  <EarPiece $top={layout.frame.metrics.top / 2} />
                  <FrontCamera $top={layout.frame.metrics.top / 2} />
                </>
              ) : null}
              {layout.frame.kind === 'tablet' ? (
                <TabletCamera $top={layout.frame.metrics.top / 2} />
              ) : null}
            </FrameShell>
          )
        ) : null}
        <CanvasSlot $layout={layout}>
          <canvas ref={canvasRef} aria-label={`${device.name} 画面`} />
          {layout?.skin?.orientation.foregroundMask && skin ? (
            <SkinMask
              src={
                skin.images.find((asset) => asset.file === layout.skin!.orientation.foregroundMask)
                  ?.url
              }
              alt=""
              aria-hidden="true"
              style={skinMaskStyle(layout)}
            />
          ) : null}
        </CanvasSlot>
        {!ready ? (
          <Overlay>
            {status === 'ready' ? (
              <>
                <Loader2 size={18} className="spin" />
                <OverlayText>正在准备画面…</OverlayText>
              </>
            ) : status === 'connecting' ? (
              <>
                <Loader2 size={18} className="spin" />
                <OverlayText>{STATUS_TEXT.connecting}</OverlayText>
              </>
            ) : status === 'error' ? (
              <>
                <OverlayText>{STATUS_TEXT.error}</OverlayText>
                {error ? <OverlayHint>{error}</OverlayHint> : null}
                <RetryButton type="button" onClick={retry}>
                  <RotateCcw size={13} />
                  重试连接
                </RetryButton>
              </>
            ) : status === 'closed' ? (
              <OverlayText>{STATUS_TEXT.closed}</OverlayText>
            ) : null}
          </Overlay>
        ) : null}
        {inputError ? <InputError role="alert">{inputError}</InputError> : null}
        {/* 文本/键盘代理：画布聚焦时持有焦点，IME 组合在此发生 */}
        <ProxyInput ref={proxyRef} aria-label={`${device.name} 输入`} tabIndex={-1} />
      </Stage>
      <ToolbarRow>
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
        />
      </ToolbarRow>
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
`

const Stage = styled.div`
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
`

/* 设备外壳：外圆角只作用于屏幕之外；overflow 裁掉装饰越界，屏幕是兄弟节点不受影响 */
const SkinShell = styled.div`
  position: absolute;
  pointer-events: none;
`
const FrameShell = styled.div<{ $frame: FrameRect }>`
  position: absolute;
  left: ${({ $frame }) => `${$frame.x}px`};
  top: ${({ $frame }) => `${$frame.y}px`};
  width: ${({ $frame }) => `${$frame.width}px`};
  height: ${({ $frame }) => `${$frame.height}px`};
  border-radius: ${({ $frame }) => `${$frame.radius}px`};
  background: var(--device-shell);
  border: 1px solid var(--device-shell-edge);
  overflow: hidden;
  pointer-events: none;
`

/* 手机听筒：上边框内居中的小胶囊，垂直位置随实际（含紧凑档）边距居中 */
const EarPiece = styled.div<{ $top: number }>`
  position: absolute;
  top: calc(${({ $top }) => $top}px - 2.5px);
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 5px;
  border-radius: 3px;
  background: var(--device-bezel-ink);
  opacity: 0.55;
`

/* 手机前摄：听筒右侧小圆点 */
const FrontCamera = styled.div<{ $top: number }>`
  position: absolute;
  top: calc(${({ $top }) => $top}px - 2.5px);
  left: calc(50% + 26px);
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--device-bezel-ink);
  opacity: 0.7;
`

/* 平板前摄：上边框居中小圆点，无听筒 */
const TabletCamera = styled.div<{ $top: number }>`
  position: absolute;
  top: calc(${({ $top }) => $top}px - 2px);
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--device-bezel-ink);
  opacity: 0.7;
`

const SkinMask = styled.img`
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  max-width: none;
  transform-origin: 0 0;
  pointer-events: none;
`

const CanvasSlot = styled.div<{ $layout: ScreenLayout | null }>`
  position: absolute;
  left: ${({ $layout }) => ($layout ? `${$layout.offsetX}px` : '0')};
  top: ${({ $layout }) => ($layout ? `${$layout.offsetY}px` : '0')};
  width: ${({ $layout }) => ($layout ? `${$layout.width}px` : '0')};
  height: ${({ $layout }) => ($layout ? `${$layout.height}px` : '0')};

  & > canvas {
    width: 100%;
    height: 100%;
    display: block;
    background: #000;
    cursor: default;
  }
`

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #9aa2ad;
  pointer-events: auto;

  .spin {
    animation: spin 1.2s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`

const OverlayText = styled.p`
  margin: 0;
  font-size: 13px;
`

const OverlayHint = styled.p`
  margin: 0;
  max-width: 360px;
  font-size: 11px;
  line-height: 1.5;
  word-break: break-all;
`

const RetryButton = styled.button`
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
`

const InputError = styled.p`
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
`

/* 文本代理：透明、1px、绝对定位在舞台内，不拦截指针 */
const ProxyInput = styled.input`
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  border: none;
  padding: 0;
  pointer-events: none;
`

const ToolbarRow = styled.div`
  flex: none;
`

export default DeviceCanvas
