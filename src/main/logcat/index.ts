import { spawn, type ChildProcess } from 'node:child_process'
import { ipcMain, type WebContents } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceSnapshot, LogcatBatchMessage, LogcatLine } from '@shared/types'
import { msg } from '../locale'

// 日志域（plan 2026-10-10-logcat-panel）：每台 running 设备一个 `adb logcat` 会话，
// 环形缓冲 + 批量推送 + ack 流控。与投屏域的刻意差异（写在通道注释，此处不重复）：
// 任意窗口可订阅、洪泛时丢最旧保最新。

const RING_CAP = 5000
/** 订阅回放的尾行数（首包） */
export const LOGCAT_REPLAY_LINES = 500
const FLUSH_INTERVAL_MS = 250
const FLUSH_LINE_THRESHOLD = 200
/** 单订阅者已发未 ack 的行数上限：超出即在本批丢弃最旧（保最新） */
const BACKLOG_LIMIT = 2000
const LINE_MAX_CHARS = 4000
const KILL_TIMEOUT_MS = 3000

interface LogcatSubscriber {
  contents: WebContents
  /** 已发送未确认的批次（upToSeq 单调；ack 时从头裁剪） */
  batches: Array<{ upToSeq: number; count: number }>
}

interface LogcatSession {
  deviceId: string
  runId: string
  serial: string
  child: ChildProcess | null
  /** 会话内单调递增行号 */
  seq: number
  /** 环形缓冲（超限批量裁头）；订阅回放与暂停恢复的读源 */
  ring: LogcatLine[]
  /** 攒批中的行（行数阈值或 flush 定时器触发发送） */
  pending: LogcatLine[]
  subscribers: Map<number, LogcatSubscriber>
  flushTimer: ReturnType<typeof setTimeout> | null
  /** stdout 半行拼接 */
  partial: string
  cleanup: Promise<void> | null
}

export interface LogcatManagerDeps {
  adbPath: () => string
  toolEnv: () => NodeJS.ProcessEnv
  /** 当前设备快照（订阅惰性建会时判 running；日志窗上下文通道返回） */
  snapshot: () => DeviceSnapshot
  /** 日志窗 sender 判定（上下文通道守卫；由 window/logcat 注入） */
  isLogcatWindow: (sender: WebContents) => boolean
}

export interface LogcatManager {
  ensureSession: (device: { id: string; runId: string; serial: string }) => void
  destroySession: (deviceId: string) => Promise<void>
  destroyAll: () => Promise<void>
  registerIpc: () => void
}

const runningDeviceOf = (
  snapshot: DeviceSnapshot,
  deviceId: string
): { runId: string; serial: string } | null => {
  const device = snapshot.devices.find((entry) => entry.id === deviceId)
  if (!device || device.status !== 'running' || !device.runId || !device.serial) return null
  return { runId: device.runId, serial: device.serial }
}

export function createLogcatManager(deps: LogcatManagerDeps): LogcatManager {
  const sessions = new Map<string, LogcatSession>()

  const killChild = (session: LogcatSession): Promise<void> => {
    const child = session.child
    session.child = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        child.off('exit', finish)
        resolve()
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, KILL_TIMEOUT_MS)
      child.once('exit', finish)
      child.kill('SIGTERM')
    })
  }

  const destroySession = (deviceId: string): Promise<void> => {
    const session = sessions.get(deviceId)
    if (!session) return Promise.resolve()
    // 幂等：并发 destroy 共享同一次清理
    if (!session.cleanup) {
      session.child?.removeAllListeners('exit')
      session.child?.removeAllListeners('error')
      if (session.flushTimer) clearTimeout(session.flushTimer)
      session.flushTimer = null
      session.pending = []
      session.subscribers.clear()
      sessions.delete(deviceId)
      session.cleanup = killChild(session)
    }
    return session.cleanup
  }

  const sendBatch = (
    session: LogcatSession,
    subscriber: LogcatSubscriber,
    lines: LogcatLine[],
    replay: boolean,
    dropped: number
  ): void => {
    if (lines.length === 0 && dropped === 0) return
    if (subscriber.contents.isDestroyed()) return
    const batch: LogcatBatchMessage = {
      deviceId: session.deviceId,
      runId: session.runId,
      replay,
      lines,
      dropped
    }
    subscriber.contents.send(IPC_CHANNELS.logcatBatch, batch)
    const last = lines.length > 0 ? lines[lines.length - 1].seq : 0
    // 空行批次（纯 dropped 标记）不占 backlog：没有可 ack 的 seq 前移
    if (lines.length > 0) subscriber.batches.push({ upToSeq: last, count: lines.length })
  }

  const flushNow = (session: LogcatSession): void => {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    if (session.pending.length === 0) return
    const lines = session.pending
    session.pending = []
    for (const subscriber of session.subscribers.values()) {
      if (subscriber.contents.isDestroyed()) continue
      const backlog = subscriber.batches.reduce((sum, entry) => sum + entry.count, 0)
      // 丢最旧保最新：本批超限的部分不发送，计入该订阅者的 dropped 标记
      const skipped = Math.max(0, backlog + lines.length - BACKLOG_LIMIT)
      const sent = skipped > 0 ? lines.slice(skipped) : lines
      sendBatch(session, subscriber, sent, false, skipped)
    }
  }

  const pushLines = (session: LogcatSession, chunk: string): void => {
    session.partial += chunk
    const parts = session.partial.split('\n')
    session.partial = parts.pop() ?? ''
    for (const raw of parts) {
      const text = raw.length > LINE_MAX_CHARS ? raw.slice(0, LINE_MAX_CHARS) : raw
      if (text.length === 0 && session.pending.length === 0 && session.ring.length === 0) continue
      session.seq += 1
      const line: LogcatLine = { seq: session.seq, text }
      session.ring.push(line)
      if (session.ring.length > RING_CAP) session.ring.splice(0, session.ring.length - RING_CAP)
      session.pending.push(line)
      if (session.pending.length >= FLUSH_LINE_THRESHOLD) flushNow(session)
    }
    if (session.pending.length > 0 && !session.flushTimer) {
      session.flushTimer = setTimeout(() => flushNow(session), FLUSH_INTERVAL_MS)
    }
  }

  const startSession = (device: { id: string; runId: string; serial: string }): LogcatSession => {
    const session: LogcatSession = {
      deviceId: device.id,
      runId: device.runId,
      serial: device.serial,
      child: null,
      seq: 0,
      ring: [],
      pending: [],
      subscribers: new Map(),
      flushTimer: null,
      partial: '',
      cleanup: null
    }
    sessions.set(device.id, session)
    let child: ChildProcess
    try {
      child = spawn(deps.adbPath(), ['-s', device.serial, 'logcat'], {
        env: deps.toolEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch {
      // spawn 同步失败（如 adb 缺失）：会话空壳保留——订阅者拿到空回放，不阻塞设备运行
      return session
    }
    session.child = child
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    const onData = (chunk: string): void => {
      if (sessions.get(session.deviceId) !== session) return
      pushLines(session, chunk)
    }
    // adb 诊断信息同样入流（罕见；保原文便于排查），与 stdout 同一批处理
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    const onExit = (): void => {
      // 意外退出（设备重启/adb server 重启）：销毁会话；设备仍在 running 时下次订阅惰性重建
      void destroySession(session.deviceId)
    }
    const onError = (): void => {
      void destroySession(session.deviceId)
    }
    child.once('exit', onExit)
    child.once('error', onError)
    return session
  }

  const ensureSession = (device: { id: string; runId: string; serial: string }): void => {
    const existing = sessions.get(device.id)
    if (existing && existing.runId === device.runId) return
    if (existing) void destroySession(device.id)
    startSession(device)
  }

  const unsubscribe = (deviceId: string, webContentsId: number): void => {
    sessions.get(deviceId)?.subscribers.delete(webContentsId)
  }

  const subscribe = (deviceId: string, contents: WebContents): void => {
    let session = sessions.get(deviceId)
    if (!session) {
      // 惰性建会：桥未及建（订阅先于 running 事件落地）或会话曾因 adb 退出被销毁
      const device = runningDeviceOf(deps.snapshot(), deviceId)
      if (!device) throw new Error(msg('logcatDeviceNotRunning'))
      session = startSession({ id: deviceId, ...device })
    }
    // 先把攒批发给既有订阅者，回放才是完整最新状态（否则 pending 尾部行会在
    // 回放与随后的 flush 中重复出现）
    flushNow(session)
    const existing = session.subscribers.get(contents.id)
    if (!existing) {
      const subscriber: LogcatSubscriber = { contents, batches: [] }
      session.subscribers.set(contents.id, subscriber)
      // 关窗统一清理：destroyed 后不再发送，也不占 backlog
      contents.once('destroyed', () => unsubscribe(deviceId, contents.id))
    } else {
      // 重复订阅幂等：重发回放前先清空旧 backlog 计数（批次已不可确认）
      existing.batches = []
    }
    const subscriber = session.subscribers.get(contents.id)!
    // 回放即缓冲尾（pending 中的行已在 ring 里，同步流程无间隙可补）
    sendBatch(session, subscriber, session.ring.slice(-LOGCAT_REPLAY_LINES), true, 0)
  }

  const acknowledge = (deviceId: string, webContentsId: number, upToSeq: number): void => {
    const subscriber = sessions.get(deviceId)?.subscribers.get(webContentsId)
    if (!subscriber) return
    while (subscriber.batches.length > 0 && subscriber.batches[0].upToSeq <= upToSeq) {
      subscriber.batches.shift()
    }
  }

  const registerIpc = (): void => {
    ipcMain.handle(IPC_CHANNELS.logcatSubscribe, (event, raw: unknown): Promise<void> => {
      const { deviceId } = raw as { deviceId: string }
      if (typeof deviceId !== 'string' || deviceId.length === 0) {
        throw new Error(`${IPC_CHANNELS.logcatSubscribe}: ${msg('logcatInvalidPayloadSuffix')}`)
      }
      return Promise.resolve(subscribe(deviceId, event.sender))
    })
    ipcMain.handle(IPC_CHANNELS.logcatUnsubscribe, (event, raw: unknown): Promise<void> => {
      const { deviceId } = raw as { deviceId: string }
      if (typeof deviceId !== 'string') {
        throw new Error(`${IPC_CHANNELS.logcatUnsubscribe}: ${msg('logcatInvalidPayloadSuffix')}`)
      }
      unsubscribe(deviceId, event.sender.id)
      return Promise.resolve()
    })
    ipcMain.handle(IPC_CHANNELS.logcatAck, (event, raw: unknown): Promise<void> => {
      const message = raw as { deviceId?: string; upToSeq?: number }
      if (
        typeof message.deviceId !== 'string' ||
        typeof message.upToSeq !== 'number' ||
        !Number.isSafeInteger(message.upToSeq)
      ) {
        throw new Error(`${IPC_CHANNELS.logcatAck}: ${msg('logcatInvalidPayloadSuffix')}`)
      }
      acknowledge(message.deviceId, event.sender.id, message.upToSeq)
      return Promise.resolve()
    })
    ipcMain.handle(IPC_CHANNELS.logcatContext, (event): DeviceSnapshot => {
      if (!deps.isLogcatWindow(event.sender)) {
        throw new Error(`${IPC_CHANNELS.logcatContext}: ${msg('logcatWindowOnlySuffix')}`)
      }
      return deps.snapshot()
    })
  }

  return {
    ensureSession,
    destroySession,
    destroyAll: () =>
      Promise.all([...sessions.keys()].map((id) => destroySession(id))).then(() => undefined),
    registerIpc
  }
}
