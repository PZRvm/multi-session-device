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

/**
 * 订阅投屏流：监听先安装、activate 后到（早到包按 viewToken 识别）。
 * 设备 running → 激活；切后台/停止 → 退订（连接保留在 main，仅停解码）。
 */
export function useDeviceScreen(device: Device | null): {
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
  const [status, setStatus] = useState<ScreenViewStatus>('idle')
  const [format, setFormat] = useState<ScreenFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  const viewTokenRef = useRef(crypto.randomUUID())
  const paintsRef = useRef(0)
  const decoderRef = useRef<StreamDecoder | null>(null)
  const expectedSeqRef = useRef(0)
  const resyncNeededRef = useRef(false)
  const ackCountRef = useRef(0)
  const generationRef = useRef(0)
  const generationListenersRef = useRef(new Set<() => void>())
  const screenRef = useRef<ScreenViewRef>({ envelope: null, width: 0, height: 0 })
  const deviceRef = useRef(device)
  deviceRef.current = device

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
    const decoder = new StreamDecoder({ onFrame: drawFrame, onError: () => undefined })
    decoderRef.current = decoder

    const sendAck = (message: ScreenPacketMessage): void => {
      ackCountRef.current += 1
      if (ackCountRef.current >= ACK_INTERVAL_PACKETS) {
        ackCountRef.current = 0
        void window.api.screen
          .ack({
            viewToken: message.viewToken,
            generation: message.generation,
            throughSeq: message.seq
          })
          .catch(() => undefined)
      }
    }

    const onPacket = (message: ScreenPacketMessage): void => {
      if (message.viewToken !== viewTokenRef.current) return
      const decoderInstance = decoderRef.current
      if (!decoderInstance) return

      if (message.type === 'configuration') {
        // 配置包 = 同步点：旋转/重同步都从这里重新开始
        expectedSeqRef.current = message.seq + 1
        resyncNeededRef.current = false
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
        if (message.generation !== generationRef.current) {
          generationRef.current = message.generation
          decoderInstance.reset()
          for (const listener of generationListenersRef.current) listener()
        }
        decoderInstance.handlePacket({
          type: 'configuration',
          seq: message.seq,
          data: message.data
        })
        return
      }
      if (resyncNeededRef.current || message.seq !== expectedSeqRef.current) {
        // 依赖段出现空洞：丢弃直到下一个配置包（main 的重同步突发会带配置来）
        resyncNeededRef.current = true
        return
      }
      if (decoderInstance.decodeQueueSize > 4) {
        // 解码拥堵：不无限积压；与空洞同策略，等重同步突发
        resyncNeededRef.current = true
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
      if (message.viewToken !== '' && message.viewToken !== viewTokenRef.current) return
      // 本视图的活动归属（streamId/generation 随重建与旋转更新，输入守卫依赖它）
      if (message.viewToken === viewTokenRef.current && screenRef.current.envelope) {
        screenRef.current.envelope.streamId = message.streamId
        screenRef.current.envelope.generation = message.generation
        screenRef.current.envelope.runId = message.runId
      }
      if (message.status === 'ready' && message.format) {
        setFormat(message.format)
        screenRef.current.width = message.format.width
        screenRef.current.height = message.format.height
      }
      if (message.error) setError(message.error)
      setStatus(message.status === 'ready' ? 'ready' : message.status)
    }

    const unsubscribeState = window.api.screen.onState(onState)
    const unsubscribePacket = window.api.screen.onPacket(onPacket)
    return () => {
      unsubscribeState()
      unsubscribePacket()
      decoder.close()
      decoderRef.current = null
      void window.api.screen.activate(null, viewTokenRef.current).catch(() => undefined)
    }
  }, [drawFrame])

  // 设备运行态 → 激活/退订（设备未运行时显式退订，停止投屏解码）
  useEffect(() => {
    if (device?.status === 'running') {
      setStatus('connecting')
      setError(null)
      screenRef.current.envelope = {
        deviceId: device.id,
        runId: device.runId ?? '',
        streamId: '',
        generation: 0,
        viewToken: viewTokenRef.current
      }
      void window.api.screen
        .activate(device.id, viewTokenRef.current)
        .then((state) => {
          if (state) {
            screenRef.current.envelope = {
              deviceId: state.deviceId,
              runId: state.runId,
              streamId: state.streamId,
              generation: state.generation,
              viewToken: viewTokenRef.current
            }
            if (state.format) {
              setFormat(state.format)
              screenRef.current.width = state.format.width
              screenRef.current.height = state.format.height
            }
            setStatus(state.status === 'ready' ? 'ready' : state.status)
          }
        })
        .catch(() => setStatus('error'))
    } else {
      setStatus('idle')
      setFormat(null)
      setError(null)
      screenRef.current.envelope = null
      void window.api.screen.activate(null, viewTokenRef.current).catch(() => undefined)
    }
  }, [device?.id, device?.status, device?.runId])

  const retry = useCallback((): void => {
    const current = deviceRef.current
    if (!current || current.status !== 'running') return
    setStatus('connecting')
    setError(null)
    void window.api.screen.retry(current.id, current.runId ?? '').catch((err) => {
      setStatus('error')
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [])

  return { canvasRef, status, format, error, onGenerationChange, screenRef, retry, paintsRef }
}
