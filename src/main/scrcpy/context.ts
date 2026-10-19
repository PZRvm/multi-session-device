import { join } from 'node:path'
import { app } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { SCRCPY_SERVER_VERSION } from './transport'
import type { ManagerContext, ScrcpyManagerDeps, StreamSession } from './types'

/** scrcpy server 二进制路径的唯一来源（视频会话与录制音频会话共用打包布局判断） */
export const scrcpyServerPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, `scrcpy-server-v${SCRCPY_SERVER_VERSION}`)
    : join(app.getAppPath(), 'resources', `scrcpy-server-v${SCRCPY_SERVER_VERSION}`)

/** 建 ManagerContext：sessions/active 的唯一载体 + 跨域共用的状态推送助手 */
export const createManagerContext = (deps: ScrcpyManagerDeps): ManagerContext => {
  const ctx: ManagerContext = {
    deps,
    sessions: new Map<string, StreamSession>(),
    active: null,
    serverPathFor: () => scrcpyServerPath(),
    mainWindowWebContents: () => {
      const window = deps.getMainWindow()
      return window && !window.isDestroyed() ? window.webContents : null
    },
    viewTokenOf: (session) =>
      ctx.active?.deviceId === session.deviceId ? ctx.active.viewToken : '',
    buildState: (session) => ({
      deviceId: session.deviceId,
      runId: session.runId,
      streamId: session.streamId,
      generation: session.generation,
      viewToken: ctx.viewTokenOf(session),
      status: session.state,
      format: session.state === 'ready' ? session.format : undefined,
      error: session.error
    }),
    sendState: (session) => {
      ctx.mainWindowWebContents()?.send(IPC_CHANNELS.screenState, ctx.buildState(session))
    }
  }
  return ctx
}
