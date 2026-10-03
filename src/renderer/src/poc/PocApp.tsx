import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { PoCGpuMode, PoCLogEntry, PoCReport } from '@shared/types'
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import { WebCodecsVideoDecoder, type VideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs'

// ---- 计量参数（与 plan 一致）----

const IDLE_MS = 10_000
const INTERACTION_MS = 10_000
const LATENCY_SAMPLES = 20
const LATENCY_INTERVAL_MS = 700
const LATENCY_TIMEOUT_MS = 2_000
/** 延迟判定：ROI 内 |Δluma|>25 的像素数超过该值视为画面变化 */
const CHANGE_PIXELS_THRESHOLD = 20
const CHANGE_PIXEL_DELTA = 25
const ROI_TOP_W = 160
const ROI_TOP_H = 200

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** ROI 内显著变化的像素数（触摸指示圈检测用） */
const roiChangedPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let count = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) > CHANGE_PIXEL_DELTA) count += 1
  }
  return count
}

const PocApp = (): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gpuMode, setGpuMode] = useState<PoCGpuMode>('host')
  const [maxSize, setMaxSize] = useState(0)
  const [logs, setLogs] = useState<PoCLogEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState('待操作')
  const [report, setReport] = useState<PoCReport | null>(null)
  const [reportPath, setReportPath] = useState<string | null>(null)

  const frameCountRef = useRef(0)
  const decoderRef = useRef<WebCodecsVideoDecoder | null>(null)

  useEffect(
    () => window.api.poc.onLog((entry) => setLogs((prev) => [...prev.slice(-300), entry])),
    []
  )

  const runStep = useCallback(
    async (label: string, action: () => Promise<unknown>): Promise<void> => {
      setBusy(label)
      setStatus(`${label}…`)
      try {
        await action()
        setStatus(`${label} 完成`)
      } catch (error) {
        setStatus(`${label} 失败：${String(error instanceof Error ? error.message : error)}`)
      } finally {
        setBusy(null)
      }
    },
    []
  )

  // CDP 驱动钩子：无头冒烟时从 window 读状态与报告（PoC dev 页专用，产品化后随页面移除）
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>)['__poc'] = {
      get status(): string {
        return status
      },
      get busy(): string | null {
        return busy
      },
      get report(): PoCReport | null {
        return report
      },
      get frames(): number {
        return frameCountRef.current
      },
      setGpu: (mode: PoCGpuMode): void => setGpuMode(mode),
      setMaxSize: (value: number): void => setMaxSize(value)
    }
  }, [status, busy, report])

  const setup = useCallback(() => runStep('初始化 AVD', () => window.api.poc.setup()), [runStep])

  const startEmulator = useCallback(
    () => runStep('启动模拟器', () => window.api.poc.emulatorStart(gpuMode)),
    [gpuMode, runStep]
  )

  const startStream = useCallback(
    () =>
      runStep('开始取流', async () => {
        const canvas = canvasRef.current
        if (!canvas) throw new Error('canvas 未就绪')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('2d context 不可用')
        decoderRef.current?.dispose()
        frameCountRef.current = 0
        const renderer: VideoFrameRenderer = {
          setSize: (width, height) => {
            canvas.width = width
            canvas.height = height
          },
          draw: (frame) => {
            frameCountRef.current += 1
            ctx.drawImage(frame, 0, 0)
          }
        }
        const decoder = new WebCodecsVideoDecoder({
          codec: ScrcpyVideoCodecId.H264,
          renderer
        })
        decoder.sizeChanged((size) => {
          setStatus(`解码器就绪 ${size.width}×${size.height}`)
        })
        decoderRef.current = decoder
        let packets = 0
        const writer = decoder.writable.getWriter()
        window.api.poc.onPacket((packet) => {
          packets += 1
          if (packets === 1) setStatus('renderer 收到首包')
          writer.write(packet as ScrcpyMediaStreamPacket).catch((error) => {
            setStatus(`解码写入失败：${String(error)}`)
          })
        })
        await window.api.poc.streamStart(maxSize)
      }),
    [maxSize, runStep]
  )

  const measure = useCallback(
    () =>
      runStep('跑一轮测量', async () => {
        const canvas = canvasRef.current
        if (!canvas || canvas.width === 0) throw new Error('画面未就绪（先取流）')
        const swipe = (up: boolean): Promise<void> =>
          window.api.poc.inject(
            up
              ? { kind: 'swipe', x1: 0.5, y1: 0.85, x2: 0.5, y2: 0.25, durationMs: 250 }
              : { kind: 'swipe', x1: 0.5, y1: 0.25, x2: 0.5, y2: 0.85, durationMs: 250 }
          )

        // 预热后静置计帧
        await sleep(5_000)
        const idleStart = frameCountRef.current
        const idleStartTs = performance.now()
        await sleep(IDLE_MS)
        const idleFrames = frameCountRef.current - idleStart
        const idleDuration = performance.now() - idleStartTs

        // 连续 swipe 计帧：手势背靠背不设间隔，内容持续变化时的解码吞吐
        const interactStart = frameCountRef.current
        const interactStartTs = performance.now()
        let swipes = 0
        let up = true
        while (performance.now() - interactStartTs < INTERACTION_MS) {
          await swipe(up)
          up = !up
          swipes += 1
        }
        const interactFrames = frameCountRef.current - interactStart
        const interactDuration = performance.now() - interactStartTs

        // 延迟 20 连发：下拉通知栏/上滑收起——手势一落笔画面即动，首变即端到端延迟
        // （触摸指示圈画在主屏 overlay，scrcpy 虚拟屏镜像里不可见，不可用）
        const roiTop = document.createElement('canvas')
        roiTop.width = ROI_TOP_W
        roiTop.height = ROI_TOP_H
        const roiTopCtx = roiTop.getContext('2d', { willReadFrequently: true })!
        const sampleTop = (): Uint8ClampedArray => {
          roiTopCtx.drawImage(
            canvas,
            0,
            0,
            canvas.width,
            Math.round(canvas.height * 0.45),
            0,
            0,
            ROI_TOP_W,
            ROI_TOP_H
          )
          return roiTopCtx.getImageData(0, 0, ROI_TOP_W, ROI_TOP_H).data
        }
        const latencySamples: number[] = []
        let timeouts = 0
        for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
          const gesture =
            i % 2 === 0
              ? { kind: 'swipe' as const, x1: 0.5, y1: 0.02, x2: 0.5, y2: 0.35, durationMs: 80 }
              : { kind: 'swipe' as const, x1: 0.5, y1: 0.6, x2: 0.5, y2: 0.2, durationMs: 80 }
          const baseline = sampleTop()
          const t0 = performance.now()
          // 注入与采样并发：await 会把整个手势时长计入延迟
          const injecting = window.api.poc.inject(gesture).catch(() => undefined)
          let hit: number | null = null
          while (performance.now() - t0 < LATENCY_TIMEOUT_MS) {
            await nextFrame()
            if (roiChangedPixels(baseline, sampleTop()) > CHANGE_PIXELS_THRESHOLD) {
              hit = performance.now() - t0
              break
            }
          }
          await injecting
          if (hit === null) timeouts += 1
          else latencySamples.push(hit)
          await sleep(LATENCY_INTERVAL_MS)
        }

        const sorted = [...latencySamples].sort((a, b) => a - b)
        const at = (ratio: number): number =>
          sorted.length === 0
            ? 0
            : Math.round(sorted[Math.min(sorted.length - 1, Math.floor(ratio * sorted.length))])
        const latency = {
          samples: sorted.length,
          timeouts,
          minMs: at(0),
          medianMs: at(0.5),
          p95Ms: at(0.95),
          maxMs: sorted.length === 0 ? 0 : Math.round(sorted[sorted.length - 1])
        }
        const result: PoCReport = {
          gpuMode,
          videoWidth: canvas.width,
          videoHeight: canvas.height,
          scrcpyServerVersion: '3.3.3',
          idle: {
            durationMs: Math.round(idleDuration),
            frames: idleFrames,
            fps: Math.round((idleFrames / idleDuration) * 1000)
          },
          interaction: {
            durationMs: Math.round(interactDuration),
            frames: interactFrames,
            fps: Math.round((interactFrames / interactDuration) * 1000),
            swipes
          },
          latency
        }
        setReport(result)
        const path = await window.api.poc.report(result)
        setReportPath(path)
      }),
    [gpuMode, runStep]
  )

  const stopAll = useCallback(
    () =>
      runStep('停止', async () => {
        await window.api.poc.stopStream()
        await window.api.poc.emulatorStop()
      }),
    [runStep]
  )

  const teardown = useCallback(
    () => runStep('清理环境', () => window.api.poc.teardown()),
    [runStep]
  )

  // 画面点击 = 触控 sanity：归一化坐标注入 tap
  const onCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    void window.api.poc
      .inject({
        kind: 'tap',
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height
      })
      .catch(() => {})
  }, [])

  return (
    <Shell>
      <Panel>
        <Title>PoC · 投屏链路闸门（≥30fps / ≤150ms）</Title>
        <Controls>
          <label>
            GPU{' '}
            <select
              value={gpuMode}
              onChange={(event) => setGpuMode(event.target.value as PoCGpuMode)}
            >
              <option value="host">host</option>
              <option value="swiftshader_indirect">swiftshader_indirect</option>
            </select>
          </label>
          <button type="button" disabled={busy !== null} onClick={() => void setup()}>
            1 初始化 AVD
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void startEmulator()}>
            2 启动模拟器
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void startStream()}>
            3 开始取流
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void measure()}>
            4 跑一轮测量
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void stopAll()}>
            停止
          </button>
          <button type="button" disabled={busy !== null} onClick={() => void teardown()}>
            清理环境
          </button>
        </Controls>
        <Status>{busy ? `${busy}…` : status}</Status>
        {report ? (
          <Report>
            <div>
              gpu={report.gpuMode} · {report.videoWidth}×{report.videoHeight} · scrcpy-server v
              {report.scrcpyServerVersion}
            </div>
            <div>
              静置 {report.idle.fps} fps · 交互 {report.interaction.fps} fps（
              {report.interaction.swipes} 次滑动）
            </div>
            <div>
              延迟中位 {report.latency.medianMs}ms · P95 {report.latency.p95Ms}ms · min{' '}
              {report.latency.minMs}ms · max {report.latency.maxMs}ms · 样本{' '}
              {report.latency.samples}/{report.latency.samples + report.latency.timeouts}
            </div>
            <div className="verdict">
              {report.interaction.fps >= 30 && report.latency.medianMs <= 150
                ? '✅ 过线（交互≥30fps 且中位延迟≤150ms）'
                : '❌ 不过线'}
            </div>
            {reportPath ? <div className="path">{reportPath}</div> : null}
          </Report>
        ) : null}
        <CanvasWrapper>
          <canvas ref={canvasRef} onClick={onCanvasClick} width={0} height={0} />
          <CanvasHint>点击画面注入 tap · 等比显示由 canvas 原生缩放承担</CanvasHint>
        </CanvasWrapper>
      </Panel>
      <LogPane>
        {logs.map((entry, index) => (
          <div key={`${entry.ts}-${index}`}>
            {new Date(entry.ts).toLocaleTimeString()} {entry.message}
          </div>
        ))}
      </LogPane>
    </Shell>
  )
}

const Shell = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #14161a;
  color: #d8dce2;
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: 12px;
  gap: 8px;
`

const Title = styled.h2`
  margin: 0;
  font-size: 14px;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  & > button {
    padding: 4px 10px;
  }
`

const Status = styled.div`
  font-size: 12px;
  color: #9aa2ad;
  min-height: 16px;
`

const Report = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 1.6;
  padding: 8px 10px;
  background: #1d2026;
  border-radius: 6px;

  .verdict {
    font-weight: 600;
  }

  .path {
    color: #9aa2ad;
    word-break: break-all;
  }
`

const CanvasWrapper = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;

  & > canvas {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #000;
    border-radius: 4px;
  }
`

const CanvasHint = styled.div`
  font-size: 11px;
  color: #6b7280;
`

const LogPane = styled.aside`
  width: 380px;
  flex: none;
  overflow-y: auto;
  padding: 10px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.5;
  background: #101216;
  color: #8f97a3;
`

export default PocApp
