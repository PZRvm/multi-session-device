import { vi } from 'vitest'
import type { NetworkState } from '@shared/types'

/**
 * App 级测试的 network 域 mock 形状（review P3-C 提炼，先例见
 * learn 2026-10-12-app-mount-subscription-test-mock-shape：App 挂载期会调
 * getAll + onChanged，mock 缺键即 TypeError）。
 */
export const networkApiMock = (
  states: Record<string, NetworkState> = {}
): {
  set: ReturnType<typeof vi.fn>
  getAll: ReturnType<typeof vi.fn>
  onChanged: () => () => void
} => ({
  set: vi.fn(async () => ({ state: null })),
  getAll: vi.fn(async () => states),
  onChanged: (): (() => void) => () => {}
})
