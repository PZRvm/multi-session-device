import { clipboard, dialog } from 'electron'
import { msg } from '../locale'
import { queueClipboard } from './clipboard'
import { createClipboardSync, type ClipboardTarget } from './clipboardSync'
import type { ManagerContext, StreamSession } from './types'

export const clipboardTarget = (ctx: ManagerContext, session: StreamSession): ClipboardTarget => ({
  session,
  deviceId: session.deviceId,
  runId: session.runId,
  streamId: session.streamId,
  viewToken: ctx.active?.deviceId === session.deviceId ? ctx.active.viewToken : ''
})

export const isClipboardTargetCurrent = (ctx: ManagerContext, target: ClipboardTarget): boolean => {
  const session = ctx.sessions.get(target.deviceId)
  return (
    ctx.mainWindowWebContents() !== null &&
    session === target.session &&
    session.state === 'ready' &&
    !session.abort.signal.aborted &&
    session.runId === target.runId &&
    session.streamId === target.streamId &&
    ctx.active?.deviceId === target.deviceId &&
    ctx.active.viewToken === target.viewToken
  )
}

/** 仅把 ready 的 active 会话交给协调器；重试期间的 preserveActive 不等于可写。 */
export const refreshClipboardBinding = (ctx: ManagerContext): void => {
  const session = ctx.active && ctx.sessions.get(ctx.active.deviceId)
  ctx.clipboardSync.rebind(
    session && session.state === 'ready' && !session.abort.signal.aborted
      ? clipboardTarget(ctx, session)
      : null
  )
}

export const createSessionClipboardSync = (
  getContext: () => ManagerContext
): ReturnType<typeof createClipboardSync> =>
  createClipboardSync({
    readSnapshot: () => {
      const injected = getContext().deps.clipboard
      if (injected) return injected.readSnapshot()
      const formats = clipboard.availableFormats()
      // 不从纯图片/文件推断“文本已清空”，也不物化这些格式的正文。
      const hasText = formats.some((format) =>
        /text\/plain|utf.?8.*plain.text|NSStringPboardType/i.test(format)
      )
      return { formats, text: hasText ? clipboard.readText() : null }
    },
    writeText: (text) => {
      const injected = getContext().deps.clipboard
      if (injected) injected.writeText(text)
      else clipboard.writeText(text)
    },
    isCurrent: (target) => isClipboardTargetCurrent(getContext(), target),
    send: (target, text, valid) => {
      const ctx = getContext()
      const session = ctx.sessions.get(target.deviceId)
      if (!session || !valid()) return Promise.resolve()
      return queueClipboard(ctx, session, target, text, 'sync', valid)
    },
    reportError: (kind, target) => {
      const ctx = getContext()
      if (ctx.deps.clipboard) {
        ctx.deps.clipboard.reportError(kind, target)
        return
      }
      if (!isClipboardTargetCurrent(ctx, target)) return
      const window = ctx.deps.getMainWindow()
      if (!window || window.isDestroyed()) return
      const key =
        kind === 'read'
          ? 'clipboardSyncReadFailed'
          : kind === 'write'
            ? 'clipboardSyncWriteFailed'
            : 'clipboardSyncOversize'
      void dialog
        .showMessageBox(window, {
          type: 'warning',
          message: msg(key),
          detail: msg('clipboardSyncDevice', { device: target.deviceId })
        })
        .catch(() => undefined)
    }
  })
