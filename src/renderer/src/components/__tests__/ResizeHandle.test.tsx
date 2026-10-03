import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampListWidth, LIST_MAX_WIDTH, LIST_MIN_WIDTH } from '../listWidth'
import ResizeHandle from '../ResizeHandle'

afterEach(cleanup)

describe('clampListWidth', () => {
  it('边界收敛：过小抬到下限、过大压到上限、区间内原样', () => {
    expect(clampListWidth(0)).toBe(LIST_MIN_WIDTH)
    expect(clampListWidth(LIST_MIN_WIDTH - 1)).toBe(LIST_MIN_WIDTH)
    expect(clampListWidth(280)).toBe(280)
    expect(clampListWidth(LIST_MAX_WIDTH + 1)).toBe(LIST_MAX_WIDTH)
  })
})

describe('ResizeHandle', () => {
  it('separator 语义：宽度与上下限进 aria 值', () => {
    render(<ResizeHandle width={280} onResize={vi.fn()} />)
    const handle = screen.getByRole('separator', { name: '调整列表宽度' })
    expect(handle.getAttribute('aria-valuenow')).toBe('280')
    expect(handle.getAttribute('aria-valuemin')).toBe(String(LIST_MIN_WIDTH))
    expect(handle.getAttribute('aria-valuemax')).toBe(String(LIST_MAX_WIDTH))
  })

  it('方向键微调 ±16px，且收敛到边界内', () => {
    const onResize = vi.fn()
    render(<ResizeHandle width={280} onResize={onResize} />)
    const handle = screen.getByRole('separator', { name: '调整列表宽度' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenNthCalledWith(1, 296)
    expect(onResize).toHaveBeenNthCalledWith(2, 264)

    const atMax = vi.fn()
    render(<ResizeHandle width={LIST_MAX_WIDTH} onResize={atMax} />)
    fireEvent.keyDown(screen.getAllByRole('separator', { name: '调整列表宽度' })[1], {
      key: 'ArrowRight'
    })
    expect(atMax).toHaveBeenCalledWith(LIST_MAX_WIDTH)
  })
})
