import { useRef, useState } from 'react'
import type { DragEvent, PointerEvent } from 'react'

// 列表行拖拽换序手势（plan 2026-11-09-device-list-drag-reorder；multi-session-browser
// useSessionDragReorder 迁移适配）：事件委托挂列表容器，行根挂标识属性——无该属性的
// 行（折叠区/过渡行）不可拖不可锚。点击与拖拽的消歧靠 Chromium 原生 dragstart 位移
// 阈值；交互控件（按钮/输入框）上发起的拖拽在 dragstart 时按 pointerdown 原点取消
// （判定只认 input/button——行根本身可能是 role=button，不能进选择器）。拖影用原生
// 整行快照；瞬态（源行/插入锚）全在 hook 本地，不进 store。

/** 行根拖拽视觉与可拖态（DeviceRow/ExternalRow 的 drag prop 形状） */
export type RowDragProps = {
  draggable: boolean
  isSource: boolean
  dropPos: 'before' | 'after' | null
}

interface UseListDragReorderOptions {
  /** 自定义 MIME：拖影越界到网页层不构成导航（browser 先例） */
  mime: string
  /** 行根标识属性名；可拖判定与锚点判定共用 */
  rowAttr: string
  /** 可拖宇宙全序（AVD = 已提交设备含折叠区设备；真机 = 全部行） */
  ids: string[]
  /** 行级禁拖门（read-only 等）；renaming 态由行内 draggable=false 自管 */
  canDrag?: (id: string) => boolean
  /** drop 合成的完整全序；零位移不调用 */
  onReorder: (ids: string[]) => void
}

export const useListDragReorder = ({
  mime,
  rowAttr,
  ids,
  canDrag,
  onReorder
}: UseListDragReorderOptions): {
  /** 容器级事件委托（pointerdown/dragstart/dragover/drop/dragend） */
  listHandlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onDragStart: (event: DragEvent<HTMLElement>) => void
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
    onDragEnd: (event: DragEvent<HTMLElement>) => void
  }
  /** 行视觉态查询（源行半透明 / 插入线位置）；draggable 门由调用方合成 */
  rowVisual: (id: string) => Pick<RowDragProps, 'isSource' | 'dropPos'>
} => {
  const [dragId, setDragId] = useState<string | null>(null)
  const [hint, setHint] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)
  const originRef = useRef<HTMLElement | null>(null)

  const rowOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null
    return target.closest<HTMLElement>(`[${rowAttr}]`)
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>): void => {
    originRef.current = event.target instanceof HTMLElement ? event.target : null
  }

  const handleDragStart = (event: DragEvent<HTMLElement>): void => {
    const row = rowOf(event.target)
    if (row === null) return
    const id = row.getAttribute(rowAttr)
    if (id === null || id === '') return
    if (canDrag?.(id) === false || originRef.current?.closest('input, button') != null) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData(mime, id)
    event.dataTransfer.effectAllowed = 'move'
    setDragId(id)
    setHint(null)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    // 非本容器发起的拖拽（外来源/跨区）不 preventDefault——系统「不可投放」光标；
    // MIME 复核是根闸：瞬态滞留（拖拽中源行被删，review P2-A）后外来源拖放不得被接受
    if (dragId === null || !event.dataTransfer.types.includes(mime)) return
    // 自愈：源行已消失（review P3-B）→ 滞留瞬态即清，此后外来源由 MIME 门挡住
    if (!ids.includes(dragId)) {
      finish()
      return
    }
    const row = rowOf(event.target)
    const id = row?.getAttribute(rowAttr) ?? null
    if (row === null || id === null) {
      if (hint !== null) setHint(null)
      return
    }
    const rect = row.getBoundingClientRect()
    const pos = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (hint?.id !== id || hint?.pos !== pos) setHint({ id, pos })
  }

  const finish = (): void => {
    originRef.current = null
    setDragId(null)
    setHint(null)
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    // 无条件拦 Electron 默认 drop 导航（白屏，review P2-A）：无效分支同样拦下
    event.preventDefault()
    if (dragId === null || hint === null || !ids.includes(dragId) || !ids.includes(hint.id)) {
      finish()
      return
    }
    const without = ids.filter((entry) => entry !== dragId)
    const anchorIdx = without.indexOf(hint.id)
    if (anchorIdx >= 0) {
      without.splice(hint.pos === 'before' ? anchorIdx : anchorIdx + 1, 0, dragId)
      const moved = without.some((entry, index) => entry !== ids[index])
      finish()
      if (moved) onReorder(without)
    } else {
      finish()
    }
  }

  const handleDragEnd = (): void => finish()

  return {
    listHandlers: {
      onPointerDown: handlePointerDown,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
      onDragEnd: handleDragEnd
    },
    rowVisual: (id) => ({
      isSource: dragId === id,
      dropPos: hint?.id === id ? hint.pos : null
    })
  }
}
