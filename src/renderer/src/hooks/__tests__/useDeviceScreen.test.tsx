import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScreenStateMessage } from '@shared/types'
import { useDeviceScreen } from '../useDeviceScreen'

// 连接目标键回归（2026-10-13 真机「先连即选投屏卡 connecting」）：真机适配器不带
// runId，本地目标键与 main 就绪推送的会话代次不匹配会永远 connecting——键在
// runId 缺席时退化为 id:*。解码器走替身（本测试只驱动状态流）。

vi.mock('../../screen/decoder', () => ({
  StreamDecoder: class {
    decodeQueueSize = 0
    handlePacket = vi.fn()
    close = vi.fn()
  }
}))

let stateListener: ((message: ScreenStateMessage) => void) | null = null
let activateToken: string | null = null

beforeEach(() => {
  stateListener = null
  activateToken = null
  ;(window as { api?: unknown }).api = {
    screen: {
      activate: vi.fn(async (id: string | null, token: string) => {
        if (id !== null) activateToken = token
        return null
      }),
      onState: (callback: (message: ScreenStateMessage) => void): (() => void) => {
        stateListener = callback
        return () => {
          stateListener = null
        }
      },
      onPacket: (): (() => void) => () => {},
      ack: vi.fn(async () => undefined),
      input: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined)
    }
  }
})

afterEach(() => {
  delete (window as { api?: unknown }).api
})

const emitState = (message: Partial<ScreenStateMessage> & { deviceId: string }): void => {
  act(() => {
    stateListener?.({
      streamId: 's1',
      generation: 0,
      viewToken: activateToken ?? '',
      status: 'ready',
      format: { codec: 'h264', width: 720, height: 1600 },
      ...message
    } as ScreenStateMessage)
  })
}

it('真机（无 runId）：激活后会话才就绪的推送要变为 ready——不再卡 connecting', () => {
  const { result } = renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  expect(result.current.status).toBe('connecting')
  // 激活时会话尚未就绪（activate 返回 null）；随后 main 推送就绪（带会话代次 runId）
  emitState({ deviceId: 'S', runId: 'ext:S:1' })
  expect(result.current.status).toBe('ready')
  expect(result.current.format).toEqual({ codec: 'h264', width: 720, height: 1600 })
})

it('真机代次自增（重连强制重建）不换目标：仍 ready', () => {
  const { result } = renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  emitState({ deviceId: 'S', runId: 'ext:S:1' })
  emitState({ deviceId: 'S', runId: 'ext:S:2' })
  expect(result.current.status).toBe('ready')
})

it('AVD 语义不变：runId 恒在场，消息代次≠本地代次（重启中）保持 connecting', () => {
  const { result } = renderHook(() => useDeviceScreen({ id: 'd1', status: 'running', runId: 'r1' }))
  emitState({ deviceId: 'd1', runId: 'r1' })
  expect(result.current.status).toBe('ready')
  // 设备重启：新代次推送先到、devices:changed 未跟上——本地目标仍是 r1
  emitState({ deviceId: 'd1', runId: 'r2' })
  expect(result.current.status).toBe('connecting')
})
