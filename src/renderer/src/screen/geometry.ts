/** 等比居中布局（纯函数）：容器 W×H 与视频 w×h → 内容矩形与缩放 */
export interface ScreenLayout {
  scale: number
  /** 内容尺寸（CSS 像素） */
  width: number
  height: number
  /** 内容矩形在容器内的偏移（黑边） */
  offsetX: number
  offsetY: number
}

export function computeLayout(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): ScreenLayout {
  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return {
    scale,
    width,
    height,
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2
  }
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 客户端坐标 → 归一化设备坐标；内容矩形之外（黑边）返回 null——黑边不接收触控 */
export function toNormalized(
  clientX: number,
  clientY: number,
  layout: ScreenLayout,
  containerOffsetX: number,
  containerOffsetY: number
): { x: number; y: number } | null {
  const localX = clientX - containerOffsetX - layout.offsetX
  const localY = clientY - containerOffsetY - layout.offsetY
  if (localX < 0 || localY < 0 || localX > layout.width || localY > layout.height) return null
  return { x: clamp01(localX / layout.width), y: clamp01(localY / layout.height) }
}

/** 已 capture 的拖动出界坐标夹到 [0,1]（与黑边拒绝 down 不同：手势不中断） */
export function toNormalizedClamped(
  clientX: number,
  clientY: number,
  layout: ScreenLayout,
  containerOffsetX: number,
  containerOffsetY: number
): { x: number; y: number } {
  const localX = clientX - containerOffsetX - layout.offsetX
  const localY = clientY - containerOffsetY - layout.offsetY
  return { x: clamp01(localX / layout.width), y: clamp01(localY / layout.height) }
}
