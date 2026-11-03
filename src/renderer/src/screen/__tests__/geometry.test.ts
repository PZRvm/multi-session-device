import { describe, expect, it } from 'vitest'
import {
  clamp01,
  computeLayout,
  FRAME_METRICS,
  toNormalized,
  toNormalizedClamped,
  type ScreenLayout
} from '../geometry'

/** 断言外框完整落进容器、屏幕完整落进外框（边距即 frame.metrics）且无负值 */
const expectContainment = (
  layout: ScreenLayout,
  containerWidth: number,
  containerHeight: number
): void => {
  const { frame } = layout
  expect(frame.x).toBeGreaterThanOrEqual(0)
  expect(frame.y).toBeGreaterThanOrEqual(0)
  expect(frame.x + frame.width).toBeLessThanOrEqual(containerWidth)
  expect(frame.y + frame.height).toBeLessThanOrEqual(containerHeight)
  expect(layout.offsetX).toBeCloseTo(frame.x + frame.metrics.left)
  expect(layout.offsetY).toBeCloseTo(frame.y + frame.metrics.top)
  expect(layout.offsetX + layout.width).toBeCloseTo(frame.x + frame.width - frame.metrics.right)
  expect(layout.offsetY + layout.height).toBeCloseTo(frame.y + frame.height - frame.metrics.bottom)
  // 外框整体居中（含安全间距内的留白）
  expect(frame.x).toBeCloseTo((containerWidth - frame.width) / 2)
  expect(frame.y).toBeCloseTo((containerHeight - frame.height) / 2)
}

describe('computeLayout 等比居中（外框预留）', () => {
  it('竖屏视频进横屏容器：以高为限，屏幕与视频同比例、整只外框居中', () => {
    const layout = computeLayout(800, 600, 360, 720)
    expect(layout).not.toBeNull()
    // generic：pad 12×2 + 上下边距 24/16、左右 14 → 可用宽 748 / 高 536，以高为限
    expect(layout!.scale).toBeCloseTo(536 / 720)
    expect(layout!.width).toBeCloseTo(268)
    expect(layout!.height).toBeCloseTo(536)
    expectContainment(layout!, 800, 600)
  })

  it('横屏视频进竖屏容器：以宽为限', () => {
    const layout = computeLayout(400, 800, 1920, 1080)
    expect(layout).not.toBeNull()
    expect(layout!.scale).toBeCloseTo(348 / 1920)
    expect(layout!.height).toBeCloseTo(195.75)
    expectContainment(layout!, 400, 800)
  })

  it('手机外框：上边框厚（听筒位）下边框薄，左右对称', () => {
    const layout = computeLayout(800, 600, 360, 720, 'phone')
    expect(layout).not.toBeNull()
    const { frame } = layout!
    expect(frame.kind).toBe('phone')
    expect(frame.radius).toBe(FRAME_METRICS.phone.outerRadius)
    expectContainment(layout!, 800, 600)
    expect(layout!.offsetY - frame.y).toBe(FRAME_METRICS.phone.top)
    expect(frame.y + frame.height - (layout!.offsetY + layout!.height)).toBe(
      FRAME_METRICS.phone.bottom
    )
    expect(layout!.offsetX - frame.x).toBe(
      frame.x + frame.width - (layout!.offsetX + layout!.width)
    )
  })

  it('平板外框：四边均匀', () => {
    const layout = computeLayout(900, 700, 1600, 2560, 'tablet')
    expect(layout).not.toBeNull()
    expectContainment(layout!, 900, 700)
    const { frame } = layout!
    expect(layout!.offsetX - frame.x).toBe(FRAME_METRICS.tablet.left)
    expect(layout!.offsetY - frame.y).toBe(FRAME_METRICS.tablet.top)
  })

  it('旋转后（宽高互换）重算：两向外框都不出容器', () => {
    const portrait = computeLayout(500, 800, 1080, 2400, 'phone')
    const landscape = computeLayout(500, 800, 2400, 1080, 'phone')
    expect(portrait).not.toBeNull()
    expect(landscape).not.toBeNull()
    expectContainment(portrait!, 500, 800)
    expectContainment(landscape!, 500, 800)
  })

  it('常规档放不下时回落紧凑档：装饰度量折半', () => {
    // 宽 38：常规档可用宽 38-24-16=-2 放不下；紧凑档 pad 6 + 边距 4 → 18 可用
    const layout = computeLayout(38, 300, 360, 720, 'phone')
    expect(layout).not.toBeNull()
    expect(layout!.frame.metrics.top).toBe(Math.round(FRAME_METRICS.phone.top / 2))
    expect(layout!.frame.radius).toBe(Math.round(FRAME_METRICS.phone.outerRadius / 2))
    expectContainment(layout!, 38, 300)
  })

  it('两档都放不下 / 非法尺寸 → null（不渲染可交互画面）', () => {
    // 紧凑档可用宽 19-12-8=-1 仍放不下
    expect(computeLayout(19, 300, 360, 720, 'phone')).toBeNull()
    expect(computeLayout(0, 600, 360, 720)).toBeNull()
    expect(computeLayout(800, 0, 360, 720)).toBeNull()
    expect(computeLayout(800, 600, 0, 720)).toBeNull()
    expect(computeLayout(800, 600, 360, 0)).toBeNull()
    expect(computeLayout(Number.NaN, 600, 360, 720)).toBeNull()
    expect(computeLayout(800, 600, -360, 720)).toBeNull()
  })
})

describe('坐标换算', () => {
  const layout = computeLayout(800, 600, 360, 720)

  it('屏幕矩形内 → 归一化坐标', () => {
    // generic 加粗后屏幕矩形从 (266, 36) 起、268×536——中心 (400, 304)
    const point = toNormalized(266 + 134, 36 + 268, layout!, 0, 0)
    expect(point).not.toBeNull()
    expect(point!.x).toBeCloseTo(0.5)
    expect(point!.y).toBeCloseTo(0.5)
  })

  it('屏幕矩形外（外框边距与工作台留白）不接收触控：返回 null', () => {
    expect(toNormalized(258, 300, layout!, 0, 0)).toBeNull() // 屏幕左缘外（外框/留白）
    expect(toNormalized(742, 300, layout!, 0, 0)).toBeNull()
    expect(toNormalized(400, 18, layout!, 0, 0)).toBeNull() // 屏幕上缘外
    expect(toNormalized(100, 100, layout!, 0, 0)).toBeNull()
  })

  it('已 capture 的拖动出界 → 夹到 [0,1]（手势不中断）', () => {
    const clamped = toNormalizedClamped(-50, 700, layout!, 0, 0)
    expect(clamped.x).toBe(0)
    expect(clamped.y).toBe(1)
  })

  it('Stage 有偏移时坐标按容器偏移换算', () => {
    const point = toNormalized(120 + 400, 40 + 304, layout!, 120, 40)
    expect(point).not.toBeNull()
    expect(point!.x).toBeCloseTo(0.5)
    expect(point!.y).toBeCloseTo(0.5)
  })

  it('clamp01 边界', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(2)).toBe(1)
  })
})
