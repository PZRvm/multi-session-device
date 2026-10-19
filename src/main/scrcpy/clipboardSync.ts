/** 文本上限取 scrcpy 两方向较小值；不分片，避免只留下最后一段。 */
export const CLIPBOARD_MAX_BYTES = 262_130
export const CLIPBOARD_POLL_MS = 300
export type ClipboardSource = 'sync' | 'paste' | 'composition'
export type ClipboardError = 'read' | 'write' | 'oversize'

export interface ClipboardTarget {
  deviceId: string
  runId: string
  streamId: string
  viewToken: string
  session: object
}
export interface ClipboardSnapshot {
  text: string | null
  formats: string[]
}
export interface ClipboardSyncDeps {
  readSnapshot: () => ClipboardSnapshot
  writeText: (text: string) => void
  isCurrent: (target: ClipboardTarget) => boolean
  send: (target: ClipboardTarget, text: string, valid: () => boolean) => Promise<void>
  reportError: (kind: ClipboardError, target: ClipboardTarget) => void
}

// UTF-8 字节数不会少于 UTF-16 长度；先 O(1) 拒绝大字符串，后续扫描最多预算长度。
const exceedsBudget = (text: string): boolean =>
  text.length > CLIPBOARD_MAX_BYTES || Buffer.byteLength(text, 'utf8') > CLIPBOARD_MAX_BYTES

const sameTarget = (a: ClipboardTarget | null, b: ClipboardTarget | null): boolean =>
  a === b ||
  !!(
    a &&
    b &&
    a.session === b.session &&
    a.viewToken === b.viewToken &&
    a.runId === b.runId &&
    a.streamId === b.streamId &&
    a.deviceId === b.deviceId
  )

/** 无 Electron/IPC 依赖，所有宿主读写与出站写入均通过接缝注入。 */
export function createClipboardSync(deps: ClipboardSyncDeps): {
  rebind: (target: ClipboardTarget | null) => void
  acceptDeviceText: (target: ClipboardTarget, text: string) => void
  observeLocalWrite: (target: ClipboardTarget, text: string, source: ClipboardSource) => void
  /** 解绑全部并停止轮询；非终态——destroyAll 后会话重建时仍可重新绑定
   *  （退出折返恢复依赖这一点，勿改成带 disposed 标志的永久停用）。 */
  unbindAll: () => void
} {
  let active: ClipboardTarget | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let baseline: string | undefined
  let unverifiedWrite: string | undefined
  let revision = 0
  let epoch = 0
  let readFailed = false
  let errors = new Set<ClipboardError>()
  let echoes = new WeakMap<
    object,
    Array<{ text: string; until: number; source: ClipboardSource }>
  >()

  const current = (target: ClipboardTarget): boolean =>
    sameTarget(active, target) && deps.isCurrent(target)
  const report = (kind: ClipboardError, target: ClipboardTarget): void => {
    if (!current(target) || errors.has(kind)) return
    errors.add(kind)
    // 错误通知不能结束 clipboard 消费循环，即使宿主窗口已销毁。
    try {
      deps.reportError(kind, target)
    } catch {
      /* 通知不可用 */
    }
  }
  const snapshot = (
    target: ClipboardTarget
  ): { value: ClipboardSnapshot; key: string; oversize: boolean } | null => {
    try {
      const raw = deps.readSnapshot()
      const oversize = raw.text !== null && exceedsBudget(raw.text)
      // 超限正文不进入基线，也不做全文哈希/序列化；标记区别于无文本，保留恢复时的变化。
      const value = { text: oversize ? null : raw.text, formats: [...raw.formats].sort() }
      readFailed = false
      return {
        value,
        key: JSON.stringify(oversize ? { ...value, oversize: true } : value),
        oversize
      }
    } catch {
      readFailed = true
      report('read', target)
      return null
    }
  }
  const allowed = (text: string, target: ClipboardTarget): boolean => {
    if (!text) return false
    if (exceedsBudget(text)) {
      report('oversize', target)
      return false
    }
    return true
  }
  const sample = (target: ClipboardTarget): { changed: boolean; text: string | null } | null => {
    const next = snapshot(target)
    if (!next) return null
    if (unverifiedWrite !== undefined) {
      const ownText = unverifiedWrite
      unverifiedWrite = undefined
      if (next.value.text === ownText) {
        baseline = next.key
        return { changed: false, text: next.value.text }
      }
    }
    if (baseline === undefined) {
      baseline = next.key
      return { changed: false, text: next.value.text }
    }
    if (next.key === baseline) return { changed: false, text: next.value.text }
    baseline = next.key
    const version = ++revision
    const binding = epoch
    const valid = (): boolean => binding === epoch && version === revision && current(target)
    if (next.oversize) report('oversize', target)
    else if (next.value.text) {
      // 入队必须非阻塞，避免设备推送与 ACK 在同一读通道中相互等待。
      void deps.send(target, next.value.text, valid).catch(() => {
        // 传输失败归会话的控制错误/清理路径；不重复弹同步错误。
      })
    }
    return { changed: true, text: next.value.text }
  }
  const stop = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const schedule = (): void => {
    if (!active) return
    const target = active
    timer = setTimeout(
      () => {
        timer = null
        if (!current(target)) {
          rebind(null)
          return
        }
        sample(target)
        schedule()
      },
      readFailed ? 3_000 : CLIPBOARD_POLL_MS
    )
    timer.unref?.()
  }
  const rebind = (target: ClipboardTarget | null): void => {
    if (sameTarget(active, target)) return
    stop()
    epoch += 1
    revision += 1
    active = target
    baseline = undefined
    unverifiedWrite = undefined
    errors = new Set()
    readFailed = false
    if (target) {
      const initial = snapshot(target)
      if (initial) baseline = initial.key
      schedule()
    }
  }
  return {
    rebind,
    observeLocalWrite: (target, text, source) => {
      const recent = (echoes.get(target.session) ?? []).filter((item) => item.until > Date.now())
      recent.push({ text, source, until: Date.now() + 2_000 })
      echoes.set(target.session, recent.slice(-16))
    },
    acceptDeviceText: (target, text) => {
      if (!current(target) || !text) return
      const recent = (echoes.get(target.session) ?? []).filter((item) => item.until > Date.now())
      echoes.set(target.session, recent)
      if (recent.some((item) => item.text === text)) return
      if (!allowed(text, target)) return
      const host = sample(target)
      if (!host || host.changed || host.text === text || !current(target)) return
      try {
        deps.writeText(text)
        // 先记录自身写入，再核验宿主格式；仅把仍相等的文本归为自身基线，避免吞掉新复制。
        baseline = JSON.stringify({ text, formats: ['text/plain'] })
        unverifiedWrite = text
        // 实际平台 format 名可能不同，成功写入后以真实格式建立准确基线。
        const actual = snapshot(target)
        if (actual?.value.text === text) {
          baseline = actual.key
          unverifiedWrite = undefined
        }
        revision += 1
      } catch {
        report('write', target)
      }
    },
    unbindAll: () => {
      rebind(null)
      echoes = new WeakMap()
    }
  }
}
