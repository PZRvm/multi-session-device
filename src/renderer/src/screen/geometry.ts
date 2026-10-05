import type { DeviceFrameKind } from '@shared/types'

/**
 * 等比居中布局（纯函数）：容器 W×H、视频 w×h 与外框类别 → 屏幕矩形 + 外框矩形。
 * 布局次序：先给外框和视口安全间距留空，再缩放视频；整只外框（含边距）居中，
 * 屏幕矩形 = 外框矩形按非对称边距内缩。屏幕自身无圆角无开孔（不裁切视频像素），
 * 外圆角只属于屏幕之外的外壳。
 */

/** 外框度量（CSS px）——装饰外壳只包在屏幕之外 */
export interface FrameMetrics {
  left: number
  right: number
  top: number
  bottom: number
  /** 外壳外圆角 */
  outerRadius: number
}

/** 各类别的外框度量（plan 2026-10-05-device-frame-and-canvas 初始设计，真机窗口调校；
 * 手机侧边 2026-10-06 由 8 加宽到 12——8px 侧边配 24px 外圆角在四角收窄发撇） */
export const FRAME_METRICS: Record<DeviceFrameKind, FrameMetrics> = {
  phone: { left: 12, right: 12, top: 18, bottom: 12, outerRadius: 20 },
  tablet: { left: 12, right: 12, top: 12, bottom: 12, outerRadius: 16 },
  generic: { left: 8, right: 8, top: 8, bottom: 8, outerRadius: 10 }
}

/** 外框与视口边缘的安全间距 */
export const SAFE_PADDING = 12
/** 窄窗口紧凑档：装饰度量折半，仍放不下则不渲染可交互画面 */
const COMPACT_SCALE = 0.5

export interface FrameRect {
  x: number
  y: number
  width: number
  height: number
  radius: number
  kind: DeviceFrameKind
  /** 实际采用的边距（紧凑档时为折半值，装饰定位用） */
  metrics: FrameMetrics
}

export interface ScreenLayout {
  scale: number
  /** 屏幕尺寸（CSS 像素，与视频同比例） */
  width: number
  height: number
  /** 屏幕矩形在容器内的偏移（offsetX/Y 即屏幕左上角；输入命中的唯一矩形） */
  offsetX: number
  offsetY: number
  /** 外框矩形（装饰，pointer-events:none，不参与命中） */
  frame: FrameRect
}

const scaledMetrics = (base: FrameMetrics, compact: boolean): FrameMetrics => {
  if (!compact) return base
  const scale = (value: number): number => Math.round(value * COMPACT_SCALE)
  return {
    left: scale(base.left),
    right: scale(base.right),
    top: scale(base.top),
    bottom: scale(base.bottom),
    outerRadius: scale(base.outerRadius)
  }
}

/**
 * 常规档放不下时回落紧凑档；两档都放不下（含零/负尺寸入参）返回 null——
 * 上层不渲染可交互画面，杜绝负尺寸/NaN 矩形。
 */
export function computeLayout(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
  frameKind: DeviceFrameKind = 'generic'
): ScreenLayout | null {
  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    !Number.isFinite(videoWidth) ||
    !Number.isFinite(videoHeight) ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    videoWidth <= 0 ||
    videoHeight <= 0
  ) {
    return null
  }
  const tiers: Array<{ metrics: FrameMetrics; padding: number }> = [
    { metrics: scaledMetrics(FRAME_METRICS[frameKind], false), padding: SAFE_PADDING },
    {
      metrics: scaledMetrics(FRAME_METRICS[frameKind], true),
      padding: SAFE_PADDING * COMPACT_SCALE
    }
  ]
  for (const tier of tiers) {
    const { metrics, padding } = tier
    const availableWidth = containerWidth - padding * 2 - metrics.left - metrics.right
    const availableHeight = containerHeight - padding * 2 - metrics.top - metrics.bottom
    if (availableWidth <= 0 || availableHeight <= 0) continue
    const scale = Math.min(availableWidth / videoWidth, availableHeight / videoHeight)
    const width = videoWidth * scale
    const height = videoHeight * scale
    const frameWidth = width + metrics.left + metrics.right
    const frameHeight = height + metrics.top + metrics.bottom
    const frameX = (containerWidth - frameWidth) / 2
    const frameY = (containerHeight - frameHeight) / 2
    return {
      scale,
      width,
      height,
      offsetX: frameX + metrics.left,
      offsetY: frameY + metrics.top,
      frame: {
        x: frameX,
        y: frameY,
        width: frameWidth,
        height: frameHeight,
        radius: metrics.outerRadius,
        kind: frameKind,
        metrics
      }
    }
  }
  return null
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 客户端坐标 → 归一化设备坐标；屏幕矩形之外（外框/工作台留白）返回 null——不发 down */
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

/** 已 capture 的拖动出界坐标夹到 [0,1]（与屏幕外拒绝 down 不同：手势不中断） */
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
