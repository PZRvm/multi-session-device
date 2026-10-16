import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScreenPacketMessage, ScreenStateMessage } from '@shared/types'
import { useDeviceScreen } from '../useDeviceScreen'
import { useDeviceInput } from '../useDeviceInput'
import { computeLayout } from '../../screen/geometry'

// 连接目标键回归（2026-10-13 真机「先连即选投屏卡 connecting」）：真机适配器不带
// runId，本地目标键与 main 就绪推送的会话代次不匹配会永远 connecting——键在
// runId 缺席时退化为 id:*。解码器走替身（本测试只驱动状态流）。

const decoder = vi.hoisted(() => ({
  handlePacket: vi.fn(),
  reset: vi.fn(),
  close: vi.fn(),
  queueSize: 0
}))

vi.mock('../../screen/decoder', () => ({
  StreamDecoder: class {
    get decodeQueueSize(): number {
      return decoder.queueSize
    }
    handlePacket = decoder.handlePacket
    reset = decoder.reset
    close = decoder.close
  }
}))

let stateListener: ((message: ScreenStateMessage) => void) | null = null
let packetListener: ((message: ScreenPacketMessage) => void) | null = null
let activateToken: string | null = null

beforeEach(() => {
  vi.clearAllMocks()
  decoder.queueSize = 0
  stateListener = null
  packetListener = null
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
      onPacket: (callback: (message: ScreenPacketMessage) => void): (() => void) => {
        packetListener = callback
        return () => {
          packetListener = null
        }
      },
      ack: vi.fn(async () => undefined),
      input: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined)
    }
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  delete (window as { api?: unknown }).api
})

it('真实投屏/输入 hook 联动：重建清理已排队 Move，设备释放与新手势使用新代次', () => {
  const container = document.createElement('div')
  const proxy = document.createElement('input')
  container.append(proxy)
  document.body.append(container)
  const layout = computeLayout(600, 800, 720, 1600)!
  const stageRef = { current: container }
  const proxyRef = { current: proxy }
  const layoutRef = { current: layout }
  let queued: FrameRequestCallback | null = null
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queued = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    queued = null
  })
  renderHook(() => {
    const screen = useDeviceScreen({ id: 'S', status: 'running' })
    useDeviceInput({
      canvasContainerRef: stageRef,
      inputProxyRef: proxyRef,
      screenRef: screen.screenRef,
      layoutRef,
      enabled: true,
      onGenerationChange: screen.onGenerationChange,
      onInputError: vi.fn()
    })
  })
  emitState({ deviceId: 'S', runId: 'ext:S:1', generation: 1 })
  emitPacket({ type: 'configuration', seq: 0 })
  const pointer = (kind: string): void => {
    const event = new MouseEvent(kind, {
      bubbles: true,
      button: 0,
      clientX: layout.offsetX + layout.width / 2,
      clientY: layout.offsetY + layout.height / 2
    })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    fireEvent(container, event)
  }
  pointer('pointerdown')
  pointer('pointermove')
  const staleRaf = queued
  emitPacket({ type: 'configuration', seq: 100, generation: 2 })
  act(() => (staleRaf as FrameRequestCallback | null)?.(0))
  pointer('pointerup')
  const input = vi.mocked(window.api.screen.input)
  expect(
    input.mock.calls.map(([request]) =>
      request.input.kind === 'touch' ? request.input.action : request.input.kind
    )
  ).toEqual(['down', 'release-all'])
  expect(input.mock.calls[1][0].generation).toBe(2)
  pointer('pointerdown')
  pointer('pointerup')
  expect(input.mock.calls.slice(2).map(([request]) => request.generation)).toEqual([2, 2])
})

const emitPacket = (
  packet: Pick<ScreenPacketMessage, 'type' | 'seq'> & Partial<ScreenPacketMessage>
): void => {
  act(() => {
    packetListener?.({
      deviceId: 'S',
      runId: 'ext:S:1',
      streamId: 's1',
      generation: 1,
      viewToken: activateToken ?? '',
      data: new Uint8Array([1]),
      ...packet
    })
  })
}

it('后台会话回放：旧配置 seq=0 后从最新关键帧 seq=120 建立连续序号并正常 ACK', () => {
  renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  emitPacket({ type: 'configuration', seq: 0 })
  emitPacket({ type: 'data', seq: 120, keyframe: true })
  for (let seq = 121; seq <= 127; seq++) emitPacket({ type: 'data', seq, keyframe: false })
  expect(decoder.handlePacket.mock.calls.map(([packet]) => packet.seq)).toEqual([
    0, 120, 121, 122, 123, 124, 125, 126, 127
  ])
  expect(window.api.screen.ack).toHaveBeenCalledWith({
    viewToken: activateToken,
    generation: 1,
    throughSeq: 127
  })
})

it('配置后忽略无依赖的 delta，关键帧之后的真正序号缺口仍阻断，等新配置恢复', () => {
  renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  emitPacket({ type: 'configuration', seq: 0 })
  emitPacket({ type: 'data', seq: 100, keyframe: false })
  emitPacket({ type: 'data', seq: 120, keyframe: true })
  emitPacket({ type: 'data', seq: 122, keyframe: false })
  emitPacket({ type: 'data', seq: 123, keyframe: false })
  expect(decoder.handlePacket.mock.calls.map(([packet]) => packet.seq)).toEqual([0, 120])
  emitPacket({ type: 'configuration', seq: 0 })
  emitPacket({ type: 'data', seq: 200, keyframe: true })
  emitPacket({ type: 'data', seq: 201, keyframe: false })
  expect(decoder.handlePacket.mock.calls.map(([packet]) => packet.seq)).toEqual([
    0, 120, 0, 200, 201
  ])
  expect(decoder.reset).toHaveBeenCalledTimes(2)
})

it('首次配置不触发 0×0 释放输入，后续旋转代次变化仍通知，同代次回放只重置解码器', () => {
  const { result } = renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  const release = vi.fn()
  result.current.onGenerationChange(release)
  expect(result.current.screenRef.current.width).toBe(0)
  emitPacket({ type: 'configuration', seq: 0 })
  expect(release).not.toHaveBeenCalled()
  emitState({ deviceId: 'S', runId: 'ext:S:1', generation: 1 })
  emitPacket({ type: 'configuration', seq: 0 })
  expect(release).not.toHaveBeenCalled()
  emitPacket({ type: 'configuration', seq: 300, generation: 2 })
  expect(release).toHaveBeenCalledTimes(1)
  expect(decoder.reset).toHaveBeenCalledTimes(3)
})

it('解码拥堵明确请求重同步且只发一次，新配置后恢复 ACK；首批 5 包不再被误杀', () => {
  renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  emitPacket({ type: 'configuration', seq: 0 })
  emitPacket({ type: 'data', seq: 120, keyframe: true })
  decoder.queueSize = 5
  for (let seq = 121; seq <= 127; seq++) emitPacket({ type: 'data', seq, keyframe: false })
  expect(window.api.screen.ack).toHaveBeenCalledWith({
    viewToken: activateToken,
    generation: 1,
    throughSeq: 127
  })
  decoder.queueSize = 17
  emitPacket({ type: 'data', seq: 128, keyframe: false })
  emitPacket({ type: 'data', seq: 129, keyframe: false })
  expect(window.api.screen.ack).toHaveBeenCalledTimes(2)
  expect(window.api.screen.ack).toHaveBeenLastCalledWith({
    viewToken: activateToken,
    generation: 1,
    throughSeq: 128,
    resync: true
  })
  decoder.queueSize = 0
  emitPacket({ type: 'configuration', seq: 200, generation: 2 })
  emitPacket({ type: 'data', seq: 201, generation: 2, keyframe: true })
  for (let seq = 202; seq <= 208; seq++)
    emitPacket({ type: 'data', seq, generation: 2, keyframe: false })
  expect(window.api.screen.ack).toHaveBeenLastCalledWith({
    viewToken: activateToken,
    generation: 2,
    throughSeq: 208
  })
})

it('已建链的序号缺口只请求一次新配置，旧视图包不会触发请求', () => {
  renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  emitPacket({ type: 'configuration', seq: 0 })
  emitPacket({ type: 'data', seq: 120, keyframe: true })
  emitPacket({ type: 'data', seq: 125, keyframe: false, viewToken: 'old-view' })
  expect(window.api.screen.ack).not.toHaveBeenCalled()
  emitPacket({ type: 'data', seq: 122, keyframe: false })
  emitPacket({ type: 'data', seq: 123, keyframe: false })
  expect(window.api.screen.ack).toHaveBeenCalledTimes(1)
  expect(window.api.screen.ack).toHaveBeenLastCalledWith({
    viewToken: activateToken,
    generation: 1,
    throughSeq: 122,
    resync: true
  })
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

it('重试发 envelope 的会话代次（review 二轮 P2-A）：真机错误态可恢复', () => {
  const api = (window as unknown as { api: { screen: { retry: ReturnType<typeof vi.fn> } } }).api
  const { result } = renderHook(() => useDeviceScreen({ id: 'S', status: 'running' }))
  // 错误态：会话代次随状态消息写入 envelope——这是重试按钮可点的前提
  emitState({
    deviceId: 'S',
    runId: 'ext:S:1',
    status: 'error',
    format: undefined,
    error: '流中断'
  })
  expect(result.current.status).toBe('error')
  act(() => {
    result.current.retry()
  })
  expect(api.screen.retry).toHaveBeenCalledWith('S', 'ext:S:1')
})

it('AVD 重试仍发 device.runId（envelope 与之一致）', () => {
  const api = (window as unknown as { api: { screen: { retry: ReturnType<typeof vi.fn> } } }).api
  const { result } = renderHook(() => useDeviceScreen({ id: 'd1', status: 'running', runId: 'r1' }))
  emitState({ deviceId: 'd1', runId: 'r1', status: 'error', format: undefined, error: 'x' })
  act(() => {
    result.current.retry()
  })
  expect(api.screen.retry).toHaveBeenCalledWith('d1', 'r1')
})
