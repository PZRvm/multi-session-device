import { describe, expect, it } from 'vitest'
import type { PoCReport } from '@shared/types'
import { isPoCReport, summarizeLatency, swipeSteps, toDevicePx, waitForBoot } from '../core'

describe('toDevicePx', () => {
  it('归一化值按尺寸换算并四舍五入', () => {
    expect(toDevicePx(0.5, 1080)).toBe(540)
    expect(toDevicePx(1, 2400)).toBe(2400)
    expect(toDevicePx(0.25, 200)).toBe(50)
  })

  it('越界夹取到 [0, size]', () => {
    expect(toDevicePx(-0.5, 100)).toBe(0)
    expect(toDevicePx(1.5, 100)).toBe(100)
  })
})

describe('swipeSteps', () => {
  it('生成含首尾端点的等分序列', () => {
    const steps = swipeSteps(0, 0, 1, 1, 4)
    expect(steps).toHaveLength(5)
    expect(steps[0]).toEqual({ x: 0, y: 0 })
    expect(steps[2]).toEqual({ x: 0.5, y: 0.5 })
    expect(steps[4]).toEqual({ x: 1, y: 1 })
  })

  it('单步 swipe 只有起点与终点', () => {
    const steps = swipeSteps(0, 1, 0, 0, 1)
    expect(steps).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 0 }
    ])
  })
})

describe('summarizeLatency', () => {
  it('输出排序后的分位数并四舍五入', () => {
    const result = summarizeLatency([120, 60, 90, 200, 75], 1)
    expect(result).toEqual({
      samples: 5,
      timeouts: 1,
      minMs: 60,
      medianMs: 90,
      p95Ms: 200,
      maxMs: 200
    })
  })

  it('空样本返回零值而非 NaN', () => {
    expect(summarizeLatency([], 3)).toEqual({
      samples: 0,
      timeouts: 3,
      minMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0
    })
  })
})

describe('isPoCReport', () => {
  const base: PoCReport = {
    gpuMode: 'host',
    videoWidth: 1080,
    videoHeight: 2400,
    scrcpyServerVersion: '3.3.3',
    idle: { durationMs: 10000, frames: 0, fps: 0 },
    interaction: { durationMs: 10000, frames: 600, fps: 60, swipes: 35 },
    latency: { samples: 20, timeouts: 0, minMs: 50, medianMs: 70, p95Ms: 120, maxMs: 130 }
  }

  it('完整报告通过', () => {
    expect(isPoCReport(base)).toBe(true)
  })

  it('非法 gpuMode 拒绝', () => {
    expect(isPoCReport({ ...base, gpuMode: 'metal' })).toBe(false)
  })

  it('缺 latency 字段拒绝', () => {
    const { latency: _latency, ...rest } = base
    expect(isPoCReport(rest)).toBe(false)
  })

  it('非对象与 null 拒绝', () => {
    expect(isPoCReport(null)).toBe(false)
    expect(isPoCReport('report')).toBe(false)
  })
})

describe('waitForBoot', () => {
  it('poll 返回 1 即完成', async () => {
    let calls = 0
    await waitForBoot(
      async () => {
        calls += 1
        return calls >= 3 ? '1' : '0'
      },
      { timeoutMs: 1000, intervalMs: 1 },
      () => Promise.resolve()
    )
    expect(calls).toBe(3)
  })

  it('poll 抛错按未启动继续等', async () => {
    let calls = 0
    await waitForBoot(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('adbd not ready')
        return '1'
      },
      { timeoutMs: 1000, intervalMs: 1 },
      () => Promise.resolve()
    )
    expect(calls).toBe(3)
  })

  it('超时抛错且错误信息含超时时长', async () => {
    await expect(
      waitForBoot(
        async () => '0',
        { timeoutMs: 50, intervalMs: 10 },
        () => Promise.resolve()
      )
    ).rejects.toThrow('5000ms 内'.replace('5000', '50'))
  })
})
