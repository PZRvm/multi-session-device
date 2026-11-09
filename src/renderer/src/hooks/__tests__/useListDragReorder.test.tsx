import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useListDragReorder } from '../useListDragReorder'

afterEach(cleanup)

const dataTransfer = (
  mime = 'application/x-msd-test'
): {
  setData: ReturnType<typeof vi.fn>
  effectAllowed: string
  dropEffect: string
  types: string[]
} => ({
  setData: vi.fn(),
  effectAllowed: '',
  dropEffect: '',
  types: [mime]
})

/** 手势探针：渲染 ids 子集（unrendered 模拟折叠区/不可见设备——仍在可拖宇宙里） */
const Harness = ({
  ids,
  rendered,
  onReorder,
  canDrag
}: {
  ids: string[]
  rendered: string[]
  onReorder: (ids: string[]) => void
  canDrag?: (id: string) => boolean
}): React.JSX.Element => {
  const { listHandlers, rowVisual } = useListDragReorder({
    mime: 'application/x-msd-test',
    rowAttr: 'data-drag-id',
    ids,
    canDrag,
    onReorder
  })
  return (
    <div data-testid="list" {...listHandlers}>
      {rendered.map((id) => {
        const visual = rowVisual(id)
        return (
          <div
            key={id}
            data-testid={`row-${id}`}
            data-drag-id={id}
            draggable
            data-drop-pos={visual.dropPos ?? undefined}
            className={visual.isSource ? 'drag-source' : undefined}
          >
            <button type="button" data-testid={`btn-${id}`}>
              act
            </button>
          </div>
        )
      })}
      <div data-testid="inert">无标识行（不可锚）</div>
    </div>
  )
}

/** jsdom 无 DragEvent 构造，fireEvent 的 init 透传不了 clientY——原生事件 +
 *  defineProperty 直达（React 合成事件读原生属性）；rect 桩走项目先例的原型级 spy */
const dragOverWith = (el: Element, clientY: number, dt: unknown): boolean => {
  const event = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'dataTransfer', { value: dt })
  return el.dispatchEvent(event)
}

const stubMidpoint = (el: Element, before: boolean): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    if (this === el) return { top: before ? 15 : -5, height: 0 } as DOMRect
    return { top: 0, height: 0 } as DOMRect
  })
}

describe('useListDragReorder 手势（plan 2026-11-09-device-list-drag-reorder）', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('dragstart 写自定义 MIME 并标源行；dragend 清瞬态', () => {
    const onReorder = vi.fn()
    render(<Harness ids={['a', 'b']} rendered={['a', 'b']} onReorder={onReorder} />)
    const rowA = screen.getByTestId('row-a')
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    expect(fireEvent.dragStart(rowA, { dataTransfer: dt })).toBe(true)
    expect(dt.setData).toHaveBeenCalledWith('application/x-msd-test', 'a')
    expect(dt.effectAllowed).toBe('move')
    expect(rowA.className).toContain('drag-source')
    fireEvent.dragEnd(rowA)
    expect(rowA.className).not.toContain('drag-source')
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('原点落在按钮内取消 dragstart（不误触行内动作）', () => {
    render(<Harness ids={['a']} rendered={['a']} onReorder={vi.fn()} />)
    const dt = dataTransfer()
    fireEvent.pointerDown(screen.getByTestId('btn-a'))
    expect(fireEvent.dragStart(screen.getByTestId('row-a'), { dataTransfer: dt })).toBe(false)
    expect(dt.setData).not.toHaveBeenCalled()
    expect(screen.getByTestId('row-a').className).not.toContain('drag-source')
  })

  it('canDrag 拒绝取消 dragstart（read-only 行级门）', () => {
    render(<Harness ids={['a']} rendered={['a']} onReorder={vi.fn()} canDrag={() => false} />)
    const dt = dataTransfer()
    fireEvent.pointerDown(screen.getByTestId('row-a'))
    expect(fireEvent.dragStart(screen.getByTestId('row-a'), { dataTransfer: dt })).toBe(false)
    expect(dt.setData).not.toHaveBeenCalled()
  })

  it('外来源 dragover 不 preventDefault（跨区/外部拖拽系统「不可投放」）', () => {
    render(<Harness ids={['a']} rendered={['a']} onReorder={vi.fn()} />)
    // 未经过本容器 dragstart：dragover 直接放行
    expect(fireEvent.dragOver(screen.getByTestId('row-a'), { dataTransfer: dataTransfer() })).toBe(
      true
    )
    expect(screen.getByTestId('row-a').getAttribute('data-drop-pos')).toBeNull()
  })

  it('drop 合成全序：不可见设备保持原相对位；before/after 按中点判定', async () => {
    const onReorder = vi.fn()
    const { unmount } = render(
      <Harness ids={['a', 'hidden', 'b', 'c']} rendered={['a', 'b', 'c']} onReorder={onReorder} />
    )
    const rowA = screen.getByTestId('row-a')
    const rowC = screen.getByTestId('row-c')
    stubMidpoint(rowC, true)
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    fireEvent.dragStart(rowA, { dataTransfer: dt })
    let overPrevented = true
    await act(async () => {
      overPrevented = dragOverWith(rowC, 3, dt)
    })
    expect(overPrevented).toBe(false) // preventDefault 生效
    expect(rowC.getAttribute('data-drop-pos')).toBe('before')
    fireEvent.drop(rowC, { dataTransfer: dt })
    // a 移到 c 前；hidden/b 相对位不变
    expect(onReorder).toHaveBeenCalledWith(['hidden', 'b', 'a', 'c'])
    unmount()

    // after 分支
    onReorder.mockClear()
    render(
      <Harness ids={['a', 'hidden', 'b', 'c']} rendered={['a', 'b', 'c']} onReorder={onReorder} />
    )
    const rowA2 = screen.getByTestId('row-a')
    const rowC2 = screen.getByTestId('row-c')
    stubMidpoint(rowC2, false)
    const dt2 = dataTransfer()
    fireEvent.pointerDown(rowA2)
    fireEvent.dragStart(rowA2, { dataTransfer: dt2 })
    let overPrevented2 = true
    await act(async () => {
      overPrevented2 = dragOverWith(rowC2, 3, dt2)
    })
    expect(overPrevented2).toBe(false)
    expect(rowC2.getAttribute('data-drop-pos')).toBe('after')
    fireEvent.drop(rowC2, { dataTransfer: dt2 })
    expect(onReorder).toHaveBeenCalledWith(['hidden', 'b', 'c', 'a'])
  })

  it('零位移不提交（drop 回原位无 IPC）', async () => {
    const onReorder = vi.fn()
    render(<Harness ids={['a', 'b']} rendered={['a', 'b']} onReorder={onReorder} />)
    const rowA = screen.getByTestId('row-a')
    const rowB = screen.getByTestId('row-b')
    stubMidpoint(rowB, true)
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    fireEvent.dragStart(rowA, { dataTransfer: dt })
    await act(async () => {
      dragOverWith(rowB, 3, dt) // a 移到 b 前 = 原位
    })
    fireEvent.drop(rowB, { dataTransfer: dt })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('拖拽中源行消失（并发删除）：drop 不提交', async () => {
    const onReorder = vi.fn()
    const view = render(<Harness ids={['a', 'b']} rendered={['a', 'b']} onReorder={onReorder} />)
    const rowA = screen.getByTestId('row-a')
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    fireEvent.dragStart(rowA, { dataTransfer: dt })
    // 拖拽途中 a 被删除（ids 收缩，b 仍在）
    view.rerender(<Harness ids={['b']} rendered={['b']} onReorder={onReorder} />)
    const rowB = screen.getByTestId('row-b')
    stubMidpoint(rowB, true)
    await act(async () => {
      dragOverWith(rowB, 3, dt)
    })
    fireEvent.drop(rowB, { dataTransfer: dt })
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('review P2-A：瞬态滞留后外来源拖放不被 MIME 门接受', async () => {
    const onReorder = vi.fn()
    const view = render(<Harness ids={['a', 'b']} rendered={['a', 'b']} onReorder={onReorder} />)
    const rowA = screen.getByTestId('row-a')
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    fireEvent.dragStart(rowA, { dataTransfer: dt })
    // 拖拽途中 a 被删（dragend 不达容器，瞬态滞留）
    view.rerender(<Harness ids={['b']} rendered={['b']} onReorder={onReorder} />)
    const rowB = screen.getByTestId('row-b')
    stubMidpoint(rowB, true)
    // 外来源（types 不含本 MIME）：不 preventDefault、无插入线、无提交
    const foreign = dataTransfer('application/x-other')
    let prevented = false
    await act(async () => {
      prevented = !dragOverWith(rowB, 3, foreign)
    })
    expect(prevented).toBe(false)
    expect(rowB.getAttribute('data-drop-pos')).toBeNull()
    expect(onReorder).not.toHaveBeenCalled()
    // 自愈后本 MIME 也不再被接受（dragId 已清）
    let preventedOurs = true
    await act(async () => {
      preventedOurs = !dragOverWith(rowB, 3, dt)
    })
    expect(preventedOurs).toBe(false)
    expect(rowB.getAttribute('data-drop-pos')).toBeNull()
  })

  it('review P2-A：无效 drop 分支拦 Electron 默认导航（preventDefault）', async () => {
    const onReorder = vi.fn()
    const view = render(<Harness ids={['a', 'b']} rendered={['a', 'b']} onReorder={onReorder} />)
    const rowA = screen.getByTestId('row-a')
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    fireEvent.dragStart(rowA, { dataTransfer: dt })
    view.rerender(<Harness ids={['b']} rendered={['b']} onReorder={onReorder} />)
    const rowB = screen.getByTestId('row-b')
    stubMidpoint(rowB, true)
    // drop 无条件 preventDefault：fireEvent 返回 false = 默认行为被取消
    expect(fireEvent.drop(rowB, { dataTransfer: dt })).toBe(false)
    expect(onReorder).not.toHaveBeenCalled()
  })
})

describe('useListDragReorder 瞬态对账（review P3-B 补全）', () => {
  it('行在拖拽外消失：effect 即清瞬态，插入线不留到下一次拖拽', async () => {
    const onReorder = vi.fn()
    const view = render(<Harness ids={['a', 'b']} rendered={['a', 'b']} onReorder={onReorder} />)
    const rowA = screen.getByTestId('row-a')
    const rowB = screen.getByTestId('row-b')
    stubMidpoint(rowB, true)
    const dt = dataTransfer()
    fireEvent.pointerDown(rowA)
    fireEvent.dragStart(rowA, { dataTransfer: dt })
    await act(async () => {
      dragOverWith(rowB, 3, dt)
    })
    expect(rowB.getAttribute('data-drop-pos')).toBe('before')
    // b 被删（ids 收缩）：插入线立即消失（读取时对账）；dragId 存活（a 仍在）拖拽继续
    view.rerender(<Harness ids={['a']} rendered={['a']} onReorder={onReorder} />)
    expect(document.querySelector('[data-drop-pos]')).toBeNull()
    expect(rowA.className).toContain('drag-source')
    // a 也被删：源行半透明同步消失
    view.rerender(<Harness ids={[]} rendered={[]} onReorder={onReorder} />)
    expect(document.querySelector('.drag-source')).toBeNull()
  })
})
