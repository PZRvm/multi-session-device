import { dialog } from 'electron'
import { appIcon } from './app-icon'
import { msg } from './locale'

export interface QuitConfirmDeps {
  /** 平台接缝（默认 process.platform）：确认只在 win32 出现 */
  platform?: NodeJS.Platform
  /** 本工具启动中的设备数（准备中 + 运行实例） */
  runningCount: () => number
  /** 确认交互，返回按钮索引；缺省原生 MessageBox，接缝供单测注入 */
  ask?: (options: {
    title: string
    message: string
    detail: string
    buttons: string[]
    cancelId: number
  }) => Promise<number>
}

/**
 * Windows 关窗退出仲裁门（plan 2026-10-22-windows-process-mgmt 设计 3）：
 * win32 上关最后一个窗口即退出（平台惯例），但本工具启动的设备还在跑时先弹
 * 确认——false = 留在应用（调用方折返，quitPending 由外层 finally 复位，可
 * 再次关窗重走全流程）。mac 关窗不退出，此门恒 true、永不弹窗。
 */
export const confirmQuitIfNeeded = async (deps: QuitConfirmDeps): Promise<boolean> => {
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
