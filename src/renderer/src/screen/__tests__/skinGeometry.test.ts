import { describe, expect, it } from 'vitest'
import type { DeviceSkinPresentation } from '@shared/types'
import { computeSkinLayout, toNormalized, skinMaskStyle } from '../geometry'
const skin: DeviceSkinPresentation = {
  name: 'pixel_7',
  images: [],
  landscape: null,
  portrait: {
    frameWidth: 1200,
    frameHeight: 2541,
    screenX: 59,
    screenY: 58,
    screenWidth: 1080,
    screenHeight: 2400,
    rotation: 0
  }
}
describe('真实皮肤统一几何', () => {
  it.each([
    [1080, 2400],
    [2400, 1080]
  ])('方向 %i×%i 缩放后四角输入准确、框外拒绝', (width, height) => {
    const layout = computeSkinLayout(600, 800, width, height, skin)!
    expect(layout.skin?.rotated).toBe(width > height)
    expect(layout.width / layout.height).toBeCloseTo(width / height)
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]) {
      expect(
        toNormalized(
          layout.offsetX + x * layout.width,
          layout.offsetY + y * layout.height,
          layout,
          0,
          0
        )
      ).toEqual({ x, y })
    }
    expect(toNormalized(layout.offsetX - 1, layout.offsetY, layout, 0, 0)).toBeNull()
    expect(layout.offsetX).toBeGreaterThan(layout.frame.x)
    expect(layout.offsetY).toBeGreaterThan(layout.frame.y)
  })
  it('比例不兼容或容器无空间拒绝冒充渲染', () => {
    expect(computeSkinLayout(600, 800, 100, 100, skin)).toBeNull()
    expect(computeSkinLayout(10, 10, 1080, 2400, skin)).toBeNull()
  })
})

it.each([0, 1, 2, 3])('前景 quarter-turn %i 的尺寸和原点保持在显示矩形内', (rotation) => {
  const layout = computeSkinLayout(600, 800, 1080, 2400, skin)!
  layout.skin!.orientation = { ...layout.skin!.orientation, rotation }
  const style = skinMaskStyle(layout)
  expect(style.width).toBe(rotation % 2 ? layout.height : layout.width)
  expect(style.height).toBe(rotation % 2 ? layout.width : layout.height)
  expect(style.transform).toContain(rotation === 0 ? 'none' : `rotate(${rotation * 90}deg)`)
})
it('缺横屏布局的附加旋转也应用到前景遮罩', () => {
  const layout = computeSkinLayout(600, 800, 2400, 1080, skin)!
  expect(skinMaskStyle(layout)).toEqual({
    width: layout.height,
    height: layout.width,
    transform: `translateX(${layout.width}px) rotate(90deg)`
  })
})
