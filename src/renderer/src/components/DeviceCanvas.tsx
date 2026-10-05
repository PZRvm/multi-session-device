import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import styled from 'styled-components'
import type { Device, ScreenFormat, ScreenInput } from '@shared/types'
import { computeLayout, type ScreenLayout } from '../screen/geometry'
import { useDeviceInput } from '../hooks/useDeviceInput'
import { useDeviceScreen, type ScreenViewStatus } from '../hooks/useDeviceScreen'
import DeviceToolbar from './DeviceToolbar'

const STATUS_TEXT: Record<Exclude<ScreenViewStatus, 'idle'>, string> = {
  connecting: '连接设备画面…',
  ready: '',
  error: '画面连接失败',
  closed: '画面已关闭'
}

type DeviceCanvasProps = {
  device: Device
}

/** 右栏画面区：等比居中 canvas + 状态覆盖层 + 物理键工具条 */
const DeviceCanvas = ({ device }: DeviceCanvasProps): React.JSX.Element => {
  const { canvasRef, status, format, error, onGenerationChange, screenRef, retry, paintsRef } =
    useDeviceScreen(device)
  const proxyRef = useRef<HTMLInputElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [inputError, setInputError] = useState<string | null>(null)
  const inputErrorTimerRef = useRef(0)
  // 布局是容器尺寸 × 视频格式的纯派生，不再用 state + effect 级联
  const layout = useMemo<ScreenLayout | null>(() => {
    if (!format || containerSize.width <= 0 || containerSize.height <= 0) return null
    return computeLayout(containerSize.width, containerSize.height, format.width, format.height)
  }, [format, containerSize])
  const layoutRef = useRef<ScreenLayout | null>(null)
  // 事件回调读最新布局：ref 更新放 effect，渲染期不写 ref
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  // 容器尺寸观测：换行/拖窄/旋转都重算布局
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setContainerSize({ width: rect.width, height: rect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const focusProxy = useCallback((): void => {
    proxyRef.current?.focus()
  }, [])

  const sendInput = useCallback(
    (input: ScreenInput): void => {
      const view = screenRef.current
      if (!view.envelope) return
      void window.api.screen
        .input({ ...view.envelope, width: view.width, height: view.height, input })
        .catch(() => undefined)
    },
    [screenRef]
  )

  const showInputError = useCallback((message: string): void => {
    setInputError(message)
    window.clearTimeout(inputErrorTimerRef.current)
    inputErrorTimerRef.current = window.setTimeout(() => setInputError(null), 4_000)
  }, [])

  useDeviceInput({
    canvasContainerRef: stageRef,
    inputProxyRef: proxyRef,
    screenRef,
    layoutRef,
    enabled: status === 'ready',
    onInputError: showInputError
  })

  // 旋转：main 先释放输入；renderer 释放本地手势并等新尺寸
  useEffect(
    () =>
      onGenerationChange(() => {
        sendInput({ kind: 'release-all' })
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

  const ready = status === 'ready' && format !== null

  return (
    <Wrapper>
      <Stage ref={stageRef} onClick={focusProxy}>
        <CanvasSlot $layout={layout}>
          <canvas ref={canvasRef} aria-label={`${device.name} 画面`} />
        </CanvasSlot>
        {!ready ? (
          <Overlay>
            {status === 'connecting' ? (
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
        {inputError ? <InputError>{inputError}</InputError> : null}
        {/* 文本/键盘代理：画布聚焦时持有焦点，IME 组合在此发生 */}
        <ProxyInput ref={proxyRef} aria-label={`${device.name} 输入`} tabIndex={-1} />
      </Stage>
      <ToolbarRow>
        <DeviceToolbar
          disabled={!ready}
          onButton={(button) => sendInput({ kind: 'button', button })}
          onRotate={() => sendInput({ kind: 'rotate' })}
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
  background: #000;
  overflow: hidden;
  outline: none;
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
