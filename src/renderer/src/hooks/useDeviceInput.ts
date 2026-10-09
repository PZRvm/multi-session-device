import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { ScreenInput, ScreenKeycodeName } from '@shared/types'
import { toNormalized, toNormalizedClamped, type ScreenLayout } from '../screen/geometry'
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
  /** 最终屏幕矩形（geometry 单源；offsetX/Y 即屏幕左上角，外框/留白不在命中范围） */
  layoutRef: RefObject<ScreenLayout | null>
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
  const discardCompositionRef = useRef(false)
  const errorNotifiedRef = useRef(false)
  const enabledRef = useRef(enabled)
  const lastInputViewRef = useRef<ScreenViewRef | null>(null)
  // ref 更新放 effect：渲染期写 ref 会触发级联纪律告警（事件都在 commit 后，时序等价）
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  const send = useCallback(
    (input: ScreenInput): void => {
      // 释放使用最后一次输入的归属，布局消失不阻断；旧代次仍由 main 拒绝。
      const releasing = input.kind === 'release-all'
      const view = releasing ? lastInputViewRef.current : screenRef.current
      if (
        (!releasing && !enabledRef.current) ||
        !view?.envelope ||
        view.width <= 0 ||
        view.height <= 0
      )
        return
      if (releasing) {
        const current = screenRef.current
        const live = current.envelope
        if (
          !live ||
          live.deviceId !== view.envelope.deviceId ||
          live.runId !== view.envelope.runId ||
          live.streamId !== view.envelope.streamId ||
          live.generation !== view.envelope.generation ||
          live.viewToken !== view.envelope.viewToken ||
          current.width !== view.width ||
          current.height !== view.height
        )
          return
      }
      if (!releasing) lastInputViewRef.current = { ...view, envelope: { ...view.envelope } }
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
    },
    [screenRef, onInputError]
  )

  const releaseAll = useCallback((): void => {
    if (pointersRef.current.size > 0 || pressedKeysRef.current.size > 0) {
      send({ kind: 'release-all' })
    }
    pointersRef.current.clear()
    pressedKeysRef.current.clear()
    modeRef.current = 'none'
    if (moveRafRef.current !== 0) cancelAnimationFrame(moveRafRef.current)
    moveRafRef.current = 0
    pendingMovesRef.current.clear()
    lastInputViewRef.current = null
    if (composingRef.current) discardCompositionRef.current = true
  }, [send])

  // 坐标换算统一走 geometry（与布局同源）：屏幕矩形之外（外框/留白）不发 down，
  // 手势内出界由调用方夹取
  const normalizedAt = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const container = canvasContainerRef.current
      const layout = layoutRef.current
      if (!container || !layout) return null
      const rect = container.getBoundingClientRect()
      return toNormalized(clientX, clientY, layout, rect.left, rect.top)
    },
    [canvasContainerRef, layoutRef]
  )

  const normalizedClamped = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const container = canvasContainerRef.current
      const layout = layoutRef.current
      if (!container || !layout) return { x: 0, y: 0 }
      const rect = container.getBoundingClientRect()
      return toNormalizedClamped(clientX, clientY, layout, rect.left, rect.top)
    },
    [canvasContainerRef, layoutRef]
  )

  const acquireSlot = useCallback((): number | null => {
    const used = new Set([...pointersRef.current.values()].map((entry) => entry.slot))
    for (let slot = 0; slot < MAX_POINTERS; slot += 1) {
      if (!used.has(slot)) return slot
    }
    return null
  }, [])

  const flushMoves = useCallback((): void => {
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
  }, [send])

  const scheduleMoves = useCallback((): void => {
    if (moveRafRef.current === 0) {
      moveRafRef.current = requestAnimationFrame(flushMoves)
    }
  }, [flushMoves])

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
  }, [canvasContainerRef, normalizedAt, normalizedClamped, acquireSlot, scheduleMoves, send])

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

    const onPaste = (event: ClipboardEvent): void => {
      // 代理只转发输入，不让浏览器把粘贴留在隐藏 input；暂停时也不排队。
      event.preventDefault()
      if (!enabledRef.current || composingRef.current) return
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return
      send({ kind: 'text', text, ime: true })
    }

    const onCompositionStart = (): void => {
      composingRef.current = true
      discardCompositionRef.current = !enabledRef.current
    }

    const onCompositionEnd = (event: CompositionEvent): void => {
      const discard = discardCompositionRef.current || !enabledRef.current
      composingRef.current = false
      discardCompositionRef.current = false
      if (discard || !event.data) return
      send({ kind: 'text', text: event.data, ime: true })
    }

    proxy.addEventListener('keydown', onKeyDown)
    proxy.addEventListener('keyup', onKeyUp)
    proxy.addEventListener('beforeinput', onBeforeInput)
    proxy.addEventListener('paste', onPaste)
    proxy.addEventListener('compositionstart', onCompositionStart)
    proxy.addEventListener('compositionend', onCompositionEnd)
    return () => {
      proxy.removeEventListener('keydown', onKeyDown)
      proxy.removeEventListener('keyup', onKeyUp)
      proxy.removeEventListener('beforeinput', onBeforeInput)
      proxy.removeEventListener('paste', onPaste)
      proxy.removeEventListener('compositionstart', onCompositionStart)
      proxy.removeEventListener('compositionend', onCompositionEnd)
    }
  }, [inputProxyRef, send])

  // 禁用时释放已发出的按下状态并清本地手势，禁用期间的新输入仍丢弃。
  useEffect(() => {
    if (!enabled) releaseAll()
  }, [enabled, releaseAll])

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
    }
  }, [releaseAll])
}
