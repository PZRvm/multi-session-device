import { dialog } from 'electron'
import { appIcon } from './app-icon'
import { msg } from './locale'

export interface QuitConfirmDeps {
  /** 平台接缝（默认 process.platform）：确认只在 win32 出现 */
  platform?: NodeJS.Platform
  /** 本工具启动中的设备数（准备中 + 运行实例） */
  runningCount: () => number
  /** 会话结束旁路（缺省读模块标记；true 时恒放行不弹窗——系统关机不能被模态框挂住） */
  sessionEnding?: boolean
  /** 确认交互，返回按钮索引；缺省原生 MessageBox，接缝供单测注入 */
  ask?: (options: {
    title: string
    message: string
    detail: string
    buttons: string[]
    cancelId: number
  }) => Promise<number>
}

let sessionEnding = false

/**
 * Windows 会话结束（关机/注销）标记：窗口级 `query-session-end` / `session-end`
 * （BaseWindow 事件，win32 专属）在退出流程前到达，`before-quit` 据此跳过确认
 * 弹窗（review P2-2）。会话结束是否恒先于 before-quit 因 Windows 版本而异，
 * 真机关机剧本是最终裁决。
 */
export const markSessionEnding = (): void => {
  sessionEnding = true
}

/** 测试用：清会话结束标记 */
export const resetSessionEndingForTest = (): void => {
  sessionEnding = false
}

/**
 * Windows 关窗退出仲裁门（plan 2026-10-22-windows-process-mgmt 设计 3）：
 * win32 上关最后一个窗口即退出（平台惯例），但本工具启动的设备还在跑时先弹
 * 确认——false = 留在应用（调用方折返，quitPending 由外层 finally 复位，可
 * 再次关窗重走全流程）。mac 关窗不退出，此门恒 true、永不弹窗。
 */
export const confirmQuitIfNeeded = async (deps: QuitConfirmDeps): Promise<boolean> => {
  if (deps.sessionEnding ?? sessionEnding) return true
  const platform = deps.platform ?? process.platform
  const count = deps.runningCount()
  if (platform !== 'win32' || count === 0) return true
  const ask =
    deps.ask ??
    (async (options) =>
      (
        await dialog.showMessageBox({
          type: 'warning',
          icon: appIcon,
          ...options
        })
      ).response)
  const response = await ask({
    title: msg('quitConfirmTitle'),
    message: msg('quitConfirmMessage', { count }),
    detail: msg('quitConfirmDetail'),
    buttons: [msg('quitStayButton'), msg('quitConfirmQuitButton')],
    cancelId: 0
  })
  return response !== 0
}

/** second-instance 唤回所需的主窗最小面（结构性类型——单测不引 Electron 类型） */
export interface RevivableMainWindow {
  isMinimized(): boolean
  restore(): void
  focus(): void
}

/**
 * 「留在应用」折返后的唤回入口（issue 2026-10-22-windows-quit-stay-no-window）：
 * win32 关最后一个窗选「留在应用」后主窗已销毁、无托盘无 dock——app 无任何
 * 唤回入口。单实例锁下二次启动经 second-instance 到达这里：主窗在则聚焦
 * （还原最小化），不在则重建。mac 恒有 dock activate 兜底，此链无 mac 场景。
 */
export const reviveMainWindow = (deps: {
  getMainWindow: () => RevivableMainWindow | null
  createMainWindow: () => unknown
}): void => {
  const win = deps.getMainWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  } else {
    deps.createMainWindow()
  }
}
