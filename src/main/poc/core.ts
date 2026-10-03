import type { PoCReport } from '@shared/types'

/** 归一化坐标（0..1）→ 设备像素，越界夹取 */
export function toDevicePx(normalized: number, size: number): number {
  const clamped = Math.min(1, Math.max(0, normalized))
  return Math.round(clamped * size)
}

/** swipe 注入的步进序列（不含首尾端点外的额外点）：Down 起步 + 中间 Move + Up 收尾由调用方编排 */
export interface SwipeStep {
  x: number
  y: number
}

export function swipeSteps(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  steps: number
): SwipeStep[] {
  const result: SwipeStep[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    result.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t })
  }
  return result
}

/** 延迟样本统计——timeouts 单列，不进分位数 */
export function summarizeLatency(samples: number[], timeouts: number): PoCReport['latency'] {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (ratio: number): number => {
    if (sorted.length === 0) return 0
    const index = Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))
    return Math.round(sorted[index])
  }
  return {
    samples: sorted.length,
    timeouts,
    minMs: at(0),
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: at(sorted.length - 1 > 0 ? sorted.length - 1 : 0)
  }
}

/** 报告落盘守卫——形状不对拒绝写（IPC payload 不可信） */
export function isPoCReport(value: unknown): value is PoCReport {
  if (typeof value !== 'object' || value === null) return false
  const report = value as Record<string, unknown>
  if (report.gpuMode !== 'host' && report.gpuMode !== 'swiftshader_indirect') return false
  if (typeof report.videoWidth !== 'number' || typeof report.videoHeight !== 'number') return false
  if (typeof report.scrcpyServerVersion !== 'string') return false
  for (const key of ['idle', 'interaction'] as const) {
    const phase = report[key]
    if (typeof phase !== 'object' || phase === null) return false
    const p = phase as Record<string, unknown>
    if (
      typeof p.durationMs !== 'number' ||
      typeof p.frames !== 'number' ||
      typeof p.fps !== 'number'
    )
      return false
  }
  if (typeof report.interaction !== 'object' || report.interaction === null) return false
  if (typeof (report.interaction as Record<string, unknown>).swipes !== 'number') return false
  const latency = report.latency
  if (typeof latency !== 'object' || latency === null) return false
  for (const key of ['samples', 'timeouts', 'minMs', 'medianMs', 'p95Ms', 'maxMs'] as const) {
    if (typeof (latency as Record<string, unknown>)[key] !== 'number') return false
  }
  return true
}

/** boot 轮询：poll 返回 stdout 尾行，'1' 即完成；超时抛错 */
export async function waitForBoot(
  poll: () => Promise<string>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let output: string
    try {
      output = await poll()
    } catch {
      output = '' // adbd 未就绪时 getprop 会失败，按未启动继续等
    }
    if (output.trim() === '1') return
    await sleep(intervalMs)
  }
  throw new Error(`模拟器启动超时（${timeoutMs}ms 内 sys.boot_completed 未置 1）`)
}
