import { describe, expect, it } from 'vitest'
import { applyCropFrame, normRect, type Annotation, type EditorView } from '../editorConstants'

const fullView = (width: number, height: number): EditorView => ({
  originX: 0,
  originY: 0,
  width,
  height
})

describe('applyCropFrame 标注平移', () => {
  it('rect/text/ellipse 左上角（圆心）平移 −选区原点', () => {
    const annotations: Annotation[] = [
      {
        id: 'r',
        kind: 'rect',
        x: 30,
        y: 40,
        width: 10,
        height: 10,
        stroke: '#fa5151',
        strokeWidth: 2
      },
      { id: 't', kind: 'text', x: 30, y: 40, text: '标注', fontSize: 42, fill: '#fa5151' },
      {
        id: 'e',
        kind: 'ellipse',
        x: 30,
        y: 40,
        radiusX: 5,
        radiusY: 5,
        stroke: '#fa5151',
        strokeWidth: 2
      }
    ]
    const result = applyCropFrame(
      fullView(100, 100),
      { x: 10, y: 20, width: 50, height: 60 },
      annotations
    )
    for (const a of result.annotations) {
      expect(a.kind === 'rect' || a.kind === 'text' || a.kind === 'ellipse').toBe(true)
      if (a.kind === 'rect' || a.kind === 'text' || a.kind === 'ellipse') {
        expect(a.x).toBe(20)
        expect(a.y).toBe(20)
      }
    }
    expect(result.view).toEqual({ originX: 10, originY: 20, width: 50, height: 60 })
  })

  it('arrow 两端点整体平移', () => {
    const result = applyCropFrame(fullView(100, 100), { x: 10, y: 20, width: 50, height: 60 }, [
      { id: 'a', kind: 'arrow', x1: 15, y1: 25, x2: 45, y2: 65, stroke: '#fa5151', strokeWidth: 2 }
    ])
    const arrow = result.annotations[0]
    expect(arrow.kind).toBe('arrow')
    if (arrow.kind === 'arrow') {
      expect(arrow.x1).toBe(5)
      expect(arrow.y1).toBe(5)
      expect(arrow.x2).toBe(35)
      expect(arrow.y2).toBe(45)
    }
  })

  it('brush/mosaicBrush 折线逐点平移（偶下标 dx、奇下标 dy）', () => {
    const result = applyCropFrame(fullView(100, 100), { x: 10, y: 20, width: 50, height: 60 }, [
      { id: 'b', kind: 'brush', points: [12, 22, 30, 44], stroke: '#fa5151', strokeWidth: 5 },
      { id: 'm', kind: 'mosaicBrush', points: [12, 22, 30, 44], pixelSize: 18, width: 36 }
    ])
    expect(
      result.annotations.map((a) =>
        a.kind === 'brush' || a.kind === 'mosaicBrush' ? a.points : null
      )
    ).toEqual([
      [2, 2, 20, 24],
      [2, 2, 20, 24]
    ])
  })

  it('马赛克越出选区只保留交集，不搬移或扩大覆盖范围', () => {
    // 原交集 (40,70,20,10)，平移后为 (30,50,20,10)。
    const result = applyCropFrame(fullView(100, 100), { x: 10, y: 20, width: 50, height: 60 }, [
      { id: 'm', kind: 'mosaic', x: 40, y: 70, width: 30, height: 30, pixelSize: 10 }
    ])
    const mosaic = result.annotations[0]
    expect(mosaic.kind).toBe('mosaic')
    if (mosaic.kind === 'mosaic') {
      expect(mosaic.width).toBe(20)
      expect(mosaic.height).toBe(10)
      expect(mosaic.x).toBe(30)
      expect(mosaic.y).toBe(50)
      // 整块在新视口内：crop 源矩形不出底图（无未像素化透明边）
      expect(mosaic.x + mosaic.width).toBeLessThanOrEqual(50)
      expect(mosaic.y + mosaic.height).toBeLessThanOrEqual(60)
    }
  })

  it.each([0, 400])('裁剪移除完全在选区外或仅接触边缘的马赛克（x=%s）', (x) => {
    const result = applyCropFrame(
      fullView(1000, 1000),
      { x: 500, y: 500, width: 400, height: 400 },
      [{ id: 'm', kind: 'mosaic', x, y: 500, width: 100, height: 100, pixelSize: 10 }]
    )
    expect(result.annotations).toEqual([])
  })

  it('裁剪左上相交马赛克保留交集并按新原点平移', () => {
    const result = applyCropFrame(fullView(100, 100), { x: 20, y: 30, width: 50, height: 50 }, [
      { id: 'm', kind: 'mosaic', x: 10, y: 20, width: 30, height: 30, pixelSize: 10 }
    ])
    expect(result.annotations).toEqual([
      { id: 'm', kind: 'mosaic', x: 0, y: 0, width: 20, height: 20, pixelSize: 10 }
    ])
  })

  it('马赛克大于新视口时尺寸收缩到视口尺寸', () => {
    const result = applyCropFrame(fullView(100, 100), { x: 0, y: 0, width: 20, height: 10 }, [
      { id: 'm', kind: 'mosaic', x: 0, y: 0, width: 80, height: 80, pixelSize: 10 }
    ])
    const mosaic = result.annotations[0]
    expect(mosaic.kind).toBe('mosaic')
    if (mosaic.kind === 'mosaic') {
      expect(mosaic.width).toBe(20)
      expect(mosaic.height).toBe(10)
      expect(mosaic.x).toBe(0)
      expect(mosaic.y).toBe(0)
    }
  })
})

describe('applyCropFrame 选区夹紧', () => {
  it('越界选区夹回视口内且至少 1px（防御 undo 后旧选区越界）', () => {
    const view: EditorView = { originX: 10, originY: 10, width: 100, height: 80 }
    const result = applyCropFrame(view, { x: 200, y: 200, width: 50, height: 50 }, [])
    expect(result.view.width).toBeGreaterThanOrEqual(1)
    expect(result.view.height).toBeGreaterThanOrEqual(1)
    expect(result.view.originX).toBe(109)
    expect(result.view.originY).toBe(89)
    expect(result.view.width).toBe(1)
    expect(result.view.height).toBe(1)
  })

  it('负起点归零；超宽收窄到视口内', () => {
    const result = applyCropFrame(
      fullView(100, 80),
      { x: -10, y: -10, width: 300, height: 300 },
      []
    )
    expect(result.view).toEqual({ originX: 0, originY: 0, width: 100, height: 80 })
  })

  it('origin 随连续裁剪累积（裁剪后的视口再裁剪）', () => {
    const first = applyCropFrame(fullView(100, 100), { x: 10, y: 10, width: 50, height: 50 }, [])
    const second = applyCropFrame(first.view, { x: 5, y: 5, width: 20, height: 20 }, [])
    expect(second.view).toEqual({ originX: 15, originY: 15, width: 20, height: 20 })
  })
})

describe('normRect', () => {
  it('任意方向拖拽归一化为正矩形', () => {
    expect(normRect(30, 40, 10, 20)).toEqual({ x: 10, y: 20, width: 20, height: 20 })
    expect(normRect(10, 20, 30, 40)).toEqual({ x: 10, y: 20, width: 20, height: 20 })
  })
})
