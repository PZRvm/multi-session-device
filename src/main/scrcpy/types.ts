import type { AndroidKeyCode, ScrcpyControlMessageWriter } from '@yume-chan/scrcpy'
import type { BrowserWindow, WebContents } from 'electron'
import type { ScreenFormat, ScreenStateMessage } from '@shared/types'
import type { RecordingSource, RecordingIdentity, RecordingObserver } from './recording'
import type { CachedPacket, GopCache } from './cache'
import type { runAdb } from './proc'
import type { ClipboardQueue } from './clipboardQueue'
import type { ClipboardSyncDeps, createClipboardSync } from './clipboardSync'
import type { establishTransport, Transport } from './transport'

// ---- 预算（设计值，超限走重同步而非积压）----
/** 未确认包数/字节上限（IPC 背压；重同步突发不受此限，由缓存上限约束） */
export const MAX_UNACKED_PACKETS = 16
export const MAX_UNACKED_BYTES = 2 * 1024 * 1024
/** ACK 停滞（renderer 掉队/丢失）后强制重同步的间隔 */
export const ACK_STALL_MS = 3_000

export interface ScrcpyManagerDeps {
  adbPath: () => string
  toolEnv: () => NodeJS.ProcessEnv
  getMainWindow: () => BrowserWindow | null
  isMainSender: (sender: Electron.WebContents) => boolean
  /** 传输建立接缝（单测注入 fake transport） */
  establish?: typeof establishTransport
  /** 手动旋转的 adb 命令接缝 */
  runAdb?: typeof runAdb
  /** 宿主剪贴板接缝：测试不读写系统剪贴板。 */
  clipboard?: Pick<ClipboardSyncDeps, 'readSnapshot' | 'writeText' | 'reportError'>
}

export type SessionState = 'connecting' | 'ready' | 'error' | 'closed'

export interface StreamSession {
  deviceId: string
  runId: string
  serial: string
  streamId: string
  generation: number
  seq: number
  ptsBase: number | null
  format: ScreenFormat
  state: SessionState
  error?: string
  cache: GopCache
  transport: Transport | null
  writer: ScrcpyControlMessageWriter | null
  abort: AbortController
  /** 当前视图代次的未确认发送窗（重同步时整体作废重建） */
  outbox: CachedPacket[]
  /** 等待重同步突发（突发前不零散发数据包） */
  waitingResync: boolean
  /** 触发过一次重同步后需等 ACK 再武装（防重同步风暴） */
  resyncArmed: boolean
  /** 重同步时缓存无关键帧的连续次数（≥2 才升级 resetVideo） */
  nullReplayStalls: number
  lastAckAt: number
  recovery: {
    timer: ReturnType<typeof setTimeout> | null
    viewToken: string
    generation: number
    attempts: number
  } | null
  /** 按下指针（兜底释放） */
  pressedPointers: Set<number>
  /** 已接受的按下键（暂停前由 main 释放） */
  pressedKeys: Set<AndroidKeyCode>
  /** 方向锁定与旋转期间丢弃所有新输入 */
  rotating: boolean
  clipboardSequence: number
  clipboardQueue: ClipboardQueue | null
  /** 唯一清理 Promise（幂等） */
  cleanup: Promise<void> | null
}

export interface ActiveView {
  deviceId: string
  viewToken: string
}

/**
 * 管理器实例的共享上下文——原 createScrcpyManager 工厂闭包状态
 * （deps/sessions/active + 状态推送助手）的显式载体，域函数以首参传入。
 */
export interface ManagerContext {
  deps: ScrcpyManagerDeps
  sessions: Map<string, StreamSession>
  /** 当前激活视图（screenActivate 写入；cleanupSession/destroyAll 清空） */
  active: ActiveView | null
  clipboardSync: ReturnType<typeof createClipboardSync>
  serverPathFor: () => string
  mainWindowWebContents: () => WebContents | null
  viewTokenOf: (session: StreamSession) => string
  buildState: (session: StreamSession) => ScreenStateMessage
  sendState: (session: StreamSession) => void
}

export interface ScrcpyManager {
  getRecordingSource: (id: string) => RecordingSource | null
  subscribeRecordingSource: (identity: RecordingIdentity, observer: RecordingObserver) => () => void
  requestRecordingKeyFrame: (identity: RecordingIdentity) => Promise<void>
  ensureSession: (device: { id: string; runId: string; serial: string }) => Promise<void>
  destroySession: (deviceId: string) => Promise<void>
  destroyAll: () => Promise<void>
  suspendForAdbRecovery: () => Promise<void>
  activeDeviceId: () => string | null
  registerIpc: () => void
}
