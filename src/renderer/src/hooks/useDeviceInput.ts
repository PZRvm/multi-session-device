import { useEffect, useRef, type RefObject } from 'react'
import type { ScreenInput, ScreenKeycodeName } from '@shared/types'
import type { ScreenViewRef } from './useDeviceScreen'

/** 最多两个活动触点（双指捏合） */
const MAX_POINTERS = 2

const KEYCODE_WHITELIST: Record<string, ScreenKeycodeName> = {
  Enter: 'enter',
  Backspace: 'backspace',
  Tab: 'tab',
  ArrowUp: 'arrow-up',
  ArrowDown: 'arrow-down',
  ArrowLeft: 'arrow-left',
  ArrowRight: 'arrow-right',
  Escape: 'escape'
}

type GestureMode = 'none' | 'direct' | 'ctrl-pinch'

interface PointerSlot {
  slot: number
  lastX: number
  lastY: number
  /** Ctrl 捏合的第二触点由锚点镜像而来，移动时同步发两份 */
  mirrored: boolean
}

export interface DeviceInputParams {
  canvasContainerRef: RefObject<HTMLDivElement | null>
  /** 文本/键盘代理（隐藏 input，画布聚焦时获得焦点） */
  inputProxyRef: RefObject<HTMLInputElement | null>
  screenRef: RefObject<ScreenViewRef>
  layoutRef: RefObject<{ offsetX: number; offsetY: number; width: number; height: number } | null>
  enabled: boolean
  /** 同一手势失败只提示一次（由调用方节流展示） */
  onInputError: (message: string) => void
}

/**
 * 画布输入适配：Pointer Events → Down/Move/Up、原生双指与 Ctrl+左键捏合（中心对称第二触点）、
 * 焦点键盘白名单、beforeinput/IME 文本。手势结束/失焦/隐藏时统一释放。
 */
export function useDeviceInput(params: DeviceInputParams): void {
  const { canvasContainerRef, inputProxyRef, screenRef, layoutRef, enabled, onInputError } = params

  const pointersRef = useRef(new Map<number, PointerSlot>())
  const modeRef = useRef<GestureMode>('none')
  const pressedKeysRef = useRef(new Set<string>())
  const pendingMovesRef = useRef(
    new Map<number, { x: number; y: number; slot: number; mirrored: boolean }>()
  )
  const moveRafRef = useRef(0)
  const composingRef = useRef(false)
  const errorNotifiedRef = useRef(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const send = (input: ScreenInput): void => {
    const view = screenRef.current
    if (!enabledRef.current || !view.envelope || view.width <= 0 || view.height <= 0) return
    window.api.screen
      .input({
        ...view.envelope,
        width: view.width,
        height: view.height,
        input
      })
      .catch((error: unknown) => {
        if (!errorNotifiedRef.current) {
          errorNotifiedRef.current = true
          onInputError(error instanceof Error ? error.message : String(error))
        }
      })
  }

  const releaseAll = (): void => {
    if (pointersRef.current.size > 0 || pressedKeysRef.current.size > 0) {
      send({ kind: 'release-all' })
    }
    pointersRef.current.clear()
    pressedKeysRef.current.clear()
    modeRef.current = 'none'
  }

  const normalizedAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const container = canvasContainerRef.current
    const layout = layoutRef.current
    if (!container || !layout) return null
    const rect = container.getBoundingClientRect()
    const localX = clientX - rect.left - layout.offsetX
    const localY = clientY - rect.top - layout.offsetY
    // 黑边不接收 down；手势内（capture）出界由调用方夹取
    if (localX < 0 || localY < 0 || localX > layout.width || localY > layout.height) return null
    return { x: localX / layout.width, y: localY / layout.height }
  }

  const normalizedClamped = (clientX: number, clientY: number): { x: number; y: number } => {
    const container = canvasContainerRef.current
    const layout = layoutRef.current!
    const rect = container!.getBoundingClientRect()
    const localX = Math.min(layout.width, Math.max(0, clientX - rect.left - layout.offsetX))
    const localY = Math.min(layout.height, Math.max(0, clientY - rect.top - layout.offsetY))
    return { x: localX / layout.width, y: localY / layout.height }
  }

  const acquireSlot = (): number | null => {
    const used = new Set([...pointersRef.current.values()].map((entry) => entry.slot))
    for (let slot = 0; slot < MAX_POINTERS; slot += 1) {
      if (!used.has(slot)) return slot
    }
    return null
  }

  const flushMoves = (): void => {
    moveRafRef.current = 0
    for (const [pointerId, move] of pendingMovesRef.current) {
      send({
        kind: 'touch',
        action: 'move',
        pointerId: move.slot,
        x: move.x,
        y: move.y,
        pressure: 1
      })
      const entry = pointersRef.current.get(pointerId)
      if (entry?.mirrored) {
        // 中心对称第二触点
        send({
          kind: 'touch',
          action: 'move',
          pointerId: (move.slot + 1) % MAX_POINTERS,
          x: 1 - move.x,
          y: 1 - move.y,
          pressure: 1
        })
      }
    }
    pendingMovesRef.current.clear()
  }

  const scheduleMoves = (): void => {
    if (moveRafRef.current === 0) {
      moveRafRef.current = requestAnimationFrame(flushMoves)
    }
  }

  // 指针事件挂在容器上（canvas 与黑边都算容器；down 只认内容矩形）
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container) return

    const onPointerDown = (event: PointerEvent): void => {
      if (!enabledRef.current) return
      if (event.button !== 0) return // 左键/单指；右键不劫持
      const point = normalizedAt(event.clientX, event.clientY)
      if (!point) return // 黑边不接收触控
      const slot = acquireSlot()
      if (slot === null) return
      const target = event.currentTarget
      if (target instanceof Element) {
        try {
          target.setPointerCapture(event.pointerId)
        } catch {
          // 合成事件/指针已释放时无活动指针：手势仍按普通事件收尾
        }
      }

      const pinch = event.ctrlKey
      if (modeRef.current === 'none') modeRef.current = pinch ? 'ctrl-pinch' : 'direct'
      if (modeRef.current !== (pinch ? 'ctrl-pinch' : 'direct')) return // 模式在 Down 时锁定至结束
      const mirrored = modeRef.current === 'ctrl-pinch'
      pointersRef.current.set(event.pointerId, { slot, lastX: point.x, lastY: point.y, mirrored })
      errorNotifiedRef.current = false
      send({ kind: 'touch', action: 'down', pointerId: slot, x: point.x, y: point.y, pressure: 1 })
      if (mirrored) {
        // 对称触点用另一个槽位
        const mirrorSlot = (slot + 1) % MAX_POINTERS
        send({
          kind: 'touch',
          action: 'down',
          pointerId: mirrorSlot,
          x: 1 - point.x,
          y: 1 - point.y,
          pressure: 1
        })
      }
    }

    const onPointerMove = (event: PointerEvent): void => {
      const entry = pointersRef.current.get(event.pointerId)
      if (!entry) return
      const point = entry.mirrored
        ? normalizedClamped(event.clientX, event.clientY)
        : (normalizedAt(event.clientX, event.clientY) ??
          normalizedClamped(event.clientX, event.clientY))
      pendingMovesRef.current.set(event.pointerId, {
        x: point.x,
        y: point.y,
        slot: entry.slot,
        mirrored: entry.mirrored
      })
      scheduleMoves()
    }

    const onPointerUp = (event: PointerEvent): void => {
      const entry = pointersRef.current.get(event.pointerId)
      if (!entry) return
      const point = normalizedClamped(event.clientX, event.clientY)
      send({
        kind: 'touch',
        action: 'up',
        pointerId: entry.slot,
        x: point.x,
        y: point.y,
        pressure: 0
      })
      if (entry.mirrored) {
        send({
          kind: 'touch',
          action: 'up',
          pointerId: (entry.slot + 1) % MAX_POINTERS,
          x: 1 - point.x,
          y: 1 - point.y,
          pressure: 0
        })
      }
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size === 0) modeRef.current = 'none'
    }

    const onPointerCancel = (event: PointerEvent): void => {
      const entry = pointersRef.current.get(event.pointerId)
      if (!entry) return
      send({ kind: 'touch', action: 'cancel', pointerId: entry.slot, x: 0, y: 0, pressure: 0 })
      if (entry.mirrored) {
        send({
          kind: 'touch',
          action: 'cancel',
          pointerId: (entry.slot + 1) % MAX_POINTERS,
          x: 0,
          y: 0,
          pressure: 0
        })
      }
      pointersRef.current.delete(event.pointerId)
      if (pointersRef.current.size === 0) modeRef.current = 'none'
    }

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerCancel)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [canvasContainerRef])

  // 键盘/文本经代理 input：焦点在画布时获得，宿主快捷键不受劫持
  useEffect(() => {
    const proxy = inputProxyRef.current
    if (!proxy) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!enabledRef.current) return
      if (event.metaKey) return // 宿主 Cmd 快捷键保留
      const key = KEYCODE_WHITELIST[event.key]
      if (!key) return
      event.preventDefault()
      if (event.repeat) return
      if (pressedKeysRef.current.has(event.key)) return
      pressedKeysRef.current.add(event.key)
      send({ kind: 'keycode', key, down: true })
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      const key = KEYCODE_WHITELIST[event.key]
      if (!key) return
      event.preventDefault()
      if (!pressedKeysRef.current.delete(event.key)) return
      send({ kind: 'keycode', key, down: false })
    }

    const onBeforeInput = (event: InputEvent): void => {
      if (!enabledRef.current) return
      // IME 组合期间不重复注入，compositionend 统一提交
      if (composingRef.current) return
      if (event.inputType !== 'insertText' || !event.data) return
      event.preventDefault()
      send({ kind: 'text', text: event.data, ime: false })
    }

    const onCompositionStart = (): void => {
      composingRef.current = true
    }

    const onCompositionEnd = (event: CompositionEvent): void => {
      composingRef.current = false
      if (!enabledRef.current || !event.data) return
      send({ kind: 'text', text: event.data, ime: true })
    }

    proxy.addEventListener('keydown', onKeyDown)
    proxy.addEventListener('keyup', onKeyUp)
    proxy.addEventListener('beforeinput', onBeforeInput)
    proxy.addEventListener('compositionstart', onCompositionStart)
    proxy.addEventListener('compositionend', onCompositionEnd)
    return () => {
      proxy.removeEventListener('keydown', onKeyDown)
      proxy.removeEventListener('keyup', onKeyUp)
      proxy.removeEventListener('beforeinput', onBeforeInput)
      proxy.removeEventListener('compositionstart', onCompositionStart)
      proxy.removeEventListener('compositionend', onCompositionEnd)
    }
  }, [inputProxyRef])

  // 失焦/隐藏/禁用/卸载：释放所有手指与按键（main 兜底再清一次）
  useEffect(() => {
    if (!enabled) releaseAll()
  }, [enabled])

  useEffect(() => {
    const onBlur = (): void => releaseAll()
    const onVisibility = (): void => {
      if (document.hidden) releaseAll()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      releaseAll()
      if (moveRafRef.current !== 0) cancelAnimationFrame(moveRafRef.current)
    }
  }, [])
}
