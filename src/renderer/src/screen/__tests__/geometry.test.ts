import { describe, expect, it } from 'vitest'
import { clamp01, computeLayout, toNormalized, toNormalizedClamped } from '../geometry'

describe('computeLayout 等比居中', () => {
  it('竖屏视频进横屏容器：以高为限，水平居中留黑边', () => {
    const layout = computeLayout(800, 600, 360, 720)
    expect(layout.scale).toBeCloseTo(600 / 720)
    expect(layout.width).toBeCloseTo(300)
    expect(layout.height).toBeCloseTo(600)
    expect(layout.offsetX).toBeCloseTo(250)
    expect(layout.offsetY).toBeCloseTo(0)
  })

  it('横屏视频进竖屏容器：以宽为限，垂直居中', () => {
    const layout = computeLayout(400, 800, 1920, 1080)
    expect(layout.scale).toBeCloseTo(400 / 1920)
    expect(layout.height).toBeCloseTo(225)
    expect(layout.offsetY).toBeCloseTo((800 - 225) / 2)
  })

  it('旋转后（宽高互换）重算不裁切', () => {
    const portrait = computeLayout(500, 800, 1080, 2400)
    const landscape = computeLayout(500, 800, 2400, 1080)
    expect(portrait.width).toBeLessThanOrEqual(500)
    expect(portrait.height).toBeLessThanOrEqual(800)
    expect(landscape.width).toBeLessThanOrEqual(500)
    expect(landscape.height).toBeLessThanOrEqual(800)
  })
})

describe('坐标换算', () => {
  const layout = computeLayout(800, 600, 360, 720)

  it('内容矩形内 → 归一化坐标', () => {
    const point = toNormalized(250 + 150, 0 + 300, layout, 0, 0)
    expect(point).not.toBeNull()
    expect(point!.x).toBeCloseTo(0.5)
    expect(point!.y).toBeCloseTo(0.5)
  })

  it('黑边（左右留白）不接收触控：返回 null', () => {
    expect(toNormalized(100, 300, layout, 0, 0)).toBeNull()
    expect(toNormalized(700, 300, layout, 0, 0)).toBeNull()
  })

  it('已 capture 的拖动出界 → 夹到 [0,1]', () => {
    const clamped = toNormalizedClamped(-50, 700, layout, 0, 0)
    expect(clamped.x).toBe(0)
    expect(clamped.y).toBe(1)
  })

  it('clamp01 边界', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(2)).toBe(1)
  })
})
