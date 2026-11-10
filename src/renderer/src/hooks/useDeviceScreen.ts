import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device, ScreenFormat, ScreenPacketMessage, ScreenStateMessage } from '@shared/types'
import { StreamDecoder } from '../screen/decoder'

export type ScreenViewStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'closed'

export interface ScreenViewRef {
  /** 输入请求的完整归属；非 ready 时为 null */
  envelope: {
    deviceId: string
    runId: string
    streamId: string
    generation: number
    viewToken: string
  } | null
  width: number
  height: number
}

const ACK_INTERVAL_PACKETS = 8
const ACK_DELAY_MS = 100
/** 首批解码启动与回放允许两个 ACK 批次，超过后显式请求新链。 */
const MAX_DECODE_QUEUE_PACKETS = ACK_INTERVAL_PACKETS * 2

/**
 * 连接目标键：${id}:${runId}。runId 缺席（真机适配器——会话代次在 main 侧持有，
 * 且重连会自增）时退化为 `${id}:*`：接受任意代次的消息，不匹配就永远停在
 * connecting（2026-10-13 真机「先连即选投屏卡住、切走再切回才好」的根因）。
 * AVD 路径 runId 恒在场，键语义不变（重启换代次即换目标）。
 */
const targetKeyOf = (id: string, runId?: string): string => `${id}:${runId ?? '*'}`

/** 投屏目标的最小形态：AVD Device 结构性满足；真机画布传 {id, status:'running'}
 *  适配器（runId 由 main 侧会话代次持有，renderer 不需要）——真机接入复用本 hook */
export type ScreenTarget = Pick<Device, 'id' | 'status' | 'runId'>

/**
 * 订阅投屏流：监听先安装、activate 后到（早到包按 viewToken 识别）。
 * 设备 running → 激活；切后台/停止 → 退订（连接保留在 main，仅停解码）。
 */
export function useDeviceScreen(device: ScreenTarget | null): {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  status: ScreenViewStatus
  format: ScreenFormat | null
  error: string | null
  /** generation 变化（旋转）时由 input hook 监听释放手势 */
  onGenerationChange: (listener: () => void) => () => void
  screenRef: React.MutableRefObject<ScreenViewRef>
  retry: () => void
  paintsRef: React.MutableRefObject<number>
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 连接状态单源：target 标记归属（运行中的 id:runId），非当前目标的存量一律不外显
  const [conn, setConn] = useState<{
    target: string
    status: ScreenViewStatus
    format: ScreenFormat | null
    error: string | null
  }>({ target: '', status: 'idle', format: null, error: null })

  const viewTokenRef = useRef(crypto.randomUUID())
  const paintsRef = useRef(0)
  const decoderRef = useRef<StreamDecoder | null>(null)
  // 配置包可能来自很早的缓存；null 表示等待回放首个关键帧建立序号起点。
  const expectedSeqRef = useRef<number | null>(0)
  const resyncNeededRef = useRef(false)
  const ackCountRef = useRef(0)
  const cancelAckRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)
  const generationListenersRef = useRef(new Set<() => void>())
  const screenRef = useRef<ScreenViewRef>({ envelope: null, width: 0, height: 0 })
  const deviceRef = useRef(device)
  // ref 更新移入 effect：渲染期写 ref 会触发级联纪律告警
  useEffect(() => {
    deviceRef.current = device
  }, [device])

  const onGenerationChange = useCallback((listener: () => void): (() => void) => {
    generationListenersRef.current.add(listener)
    return () => generationListenersRef.current.delete(listener)
  }, [])

  const drawFrame = useCallback((frame: VideoFrame): void => {
    paintsRef.current += 1
    const canvas = canvasRef.current
    if (!canvas) {
      frame.close()
      return
    }
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
      canvas.width = frame.displayWidth
      canvas.height = frame.displayHeight
    }
    const context = canvas.getContext('2d')
    if (context) {
      context.drawImage(frame, 0, 0)
    }
    frame.close()
  }, [])

  useEffect(() => {
    // viewToken 创建后不再变化：effect 内捕获局部，cleanup 免读「可能已变」的 ref
    const viewToken = viewTokenRef.current
    const decoder = new StreamDecoder({ onFrame: drawFrame, onError: () => undefined })
    decoderRef.current = decoder

    let ackTimer: ReturnType<typeof setTimeout> | null = null
    let pendingAck: ScreenPacketMessage | null = null
    const cancelPendingAck = (): void => {
      if (ackTimer !== null) clearTimeout(ackTimer)
      ackTimer = null
      pendingAck = null
      ackCountRef.current = 0
    }
    cancelAckRef.current = cancelPendingAck

    const flushAck = (): void => {
      const message = pendingAck
      cancelPendingAck()
      if (!message) return
      void window.api.screen
        .ack({
          viewToken: message.viewToken,
          generation: message.generation,
          throughSeq: message.seq
        })
        .catch(() => undefined)
    }

    const sendAck = (message: ScreenPacketMessage): void => {
      pendingAck = message
      ackCountRef.current += 1
      if (ackCountRef.current >= ACK_INTERVAL_PACKETS) {
        flushAck()
      } else if (ackTimer === null) {
        ackTimer = setTimeout(flushAck, ACK_DELAY_MS)
      }
    }

    const requestResync = (message: ScreenPacketMessage): void => {
      cancelPendingAck()
      resyncNeededRef.current = true
      // 不依赖下一批 ACK 或主进程超时：回放未确认时主进程可能尚未重新武装。
      void window.api.screen
        .ack({
          viewToken: message.viewToken,
          generation: message.generation,
          throughSeq: message.seq,
          resync: true
        })
        .catch(() => undefined)
    }

    const onPacket = (message: ScreenPacketMessage): void => {
      if (message.viewToken !== viewToken) return
      const decoderInstance = decoderRef.current
      if (!decoderInstance) return

      if (message.type === 'configuration') {
        // 配置包 = 同步点：旋转/重同步都从这里重新开始
        expectedSeqRef.current = null
        resyncNeededRef.current = false
        cancelPendingAck()
        // 归属信封随包同步：generation 变化（旋转/重配置）后输入守卫才不会误判过期
        const view = screenRef.current
        if (
          view.envelope &&
          (view.envelope.generation !== message.generation ||
            view.envelope.streamId !== message.streamId)
        ) {
          view.envelope.generation = message.generation
          view.envelope.streamId = message.streamId
          view.envelope.runId = message.runId
        }
        // 同代次回放也重建解码依赖，不能把上次的积压带入新回放。
        decoderInstance.reset()
        if (message.generation !== generationRef.current) {
          const hadGeneration = generationRef.current !== 0
          generationRef.current = message.generation
          // 首次配置时 activate 的格式响应可能尚未到，且没有旧手势需要释放。
          if (hadGeneration) {
            for (const listener of generationListenersRef.current) listener()
          }
        }
        decoderInstance.handlePacket({
          type: 'configuration',
          seq: message.seq,
          data: message.data
        })
        return
      }
      if (resyncNeededRef.current) return
      if (expectedSeqRef.current === null) {
        if (message.keyframe !== true) return // 裸 delta 不能作为依赖链起点
      } else if (message.seq !== expectedSeqRef.current) {
        // 依赖段出现空洞：丢弃直到下一个配置包（main 的重同步突发会带配置来）
        requestResync(message)
        return
      }
      if (decoderInstance.decodeQueueSize > MAX_DECODE_QUEUE_PACKETS) {
        // 解码拥堵：停止旧链，明确请求编码器重建，避免与 main 互等 ACK。
        requestResync(message)
        return
      }
      expectedSeqRef.current = message.seq + 1
      decoderInstance.handlePacket({
        type: 'data',
        seq: message.seq,
        pts: message.pts,
        keyframe: message.keyframe,
        data: message.data
      })
      sendAck(message)
    }

    const onState = (message: ScreenStateMessage): void => {
      if (message.deviceId !== deviceRef.current?.id) return
      if (message.viewToken !== '' && message.viewToken !== viewToken) return
      if (message.status !== 'ready') cancelPendingAck()
      // 本视图的活动归属（streamId/generation 随重建与旋转更新，输入守卫依赖它）
      if (message.viewToken === viewToken && screenRef.current.envelope) {
        screenRef.current.envelope.streamId = message.streamId
        screenRef.current.envelope.generation = message.generation
        screenRef.current.envelope.runId = message.runId
      }
      if (message.status === 'ready' && message.format) {
        screenRef.current.width = message.format.width
        screenRef.current.height = message.format.height
      }
      // 目标键随当前设备归一：真机（runId 缺席）按 id:* 收任意代次；AVD 用消息代次
      const key =
        deviceRef.current?.runId === undefined
          ? targetKeyOf(message.deviceId)
          : `${message.deviceId}:${message.runId}`
      // 状态/格式/错误各字段独立合并：消息缺省的字段沿用同目标的存量
      setConn((prev) => ({
        target: key,
        status: message.status === 'ready' ? 'ready' : message.status,
        format: message.format ?? (prev.target === key ? prev.format : null),
        error: message.error ?? (prev.target === key ? prev.error : null)
      }))
    }

    const unsubscribeState = window.api.screen.onState(onState)
    const unsubscribePacket = window.api.screen.onPacket(onPacket)
    return () => {
      cancelPendingAck()
      cancelAckRef.current = null
      unsubscribeState()
      unsubscribePacket()
      decoder.close()
      decoderRef.current = null
      void window.api.screen.activate(null, viewToken).catch(() => undefined)
    }
  }, [drawFrame])

  // 设备运行态 → 激活/退订（设备未运行时显式退订，停止投屏解码）。
  // 状态变迁由下方 target 派生承担，本效果只做副作用：信封维护与 IPC 往返
  useEffect(() => {
    const viewToken = viewTokenRef.current
    cancelAckRef.current?.()
    if (device?.status === 'running') {
      const key = targetKeyOf(device.id, device.runId)
      screenRef.current.envelope = {
        deviceId: device.id,
        runId: device.runId ?? '',
        streamId: '',
        generation: 0,
        viewToken
      }
      void window.api.screen
        .activate(device.id, viewToken)
        .then((state) => {
          if (!state) return
          screenRef.current.envelope = {
            deviceId: state.deviceId,
            runId: state.runId,
            streamId: state.streamId,
            generation: state.generation,
            viewToken
          }
          if (state.format) {
            screenRef.current.width = state.format.width
            screenRef.current.height = state.format.height
          }
          setConn((prev) => ({
            target: key,
            status: state.status === 'ready' ? 'ready' : state.status,
            format: state.format ?? (prev.target === key ? prev.format : null),
            error: null
          }))
        })
        .catch(() =>
          setConn((prev) => ({
            target: key,
            status: 'error',
            format: prev.target === key ? prev.format : null,
            error: null
          }))
        )
    } else {
      screenRef.current.envelope = null
      void window.api.screen.activate(null, viewToken).catch(() => undefined)
    }
  }, [device?.id, device?.status, device?.runId])

  // 派生：非运行 → idle；目标不一致（启动/切换/异步未返）→ connecting；仅同目标存量外显
  const target = device?.status === 'running' ? targetKeyOf(device.id, device.runId) : null
  const live = target !== null && conn.target === target
  const status: ScreenViewStatus = target === null ? 'idle' : live ? conn.status : 'connecting'
  const format = live ? conn.format : null
  const error = live ? conn.error : null

  const retry = useCallback((): void => {
    const current = deviceRef.current
    if (!current || current.status !== 'running') return
    setConn((prev) => ({ ...prev, status: 'connecting', error: null }))
    // runId 取 envelope 里的会话代次（review 二轮 P2-A）：真机适配器不带 runId，
    // 而状态消息持续把 envelope.runId 更新为当前会话代次——错误态可点时必有值；
    // AVD 路径 envelope.runId 与 device.runId 一致
    const runId = screenRef.current.envelope?.runId ?? current.runId ?? ''
    void window.api.screen.retry(current.id, runId).catch((err) => {
      setConn((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      }))
    })
  }, [])

  return { canvasRef, status, format, error, onGenerationChange, screenRef, retry, paintsRef }
}
