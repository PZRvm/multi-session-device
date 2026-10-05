import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import {
  isThemeMode,
  isThemeSystemId,
  resolveThemeMode,
  themeBoardBackground
} from '@shared/themeSystems'
import { getThemeState, loadThemeState, persistThemeState, updateThemeState } from './store'

/** 建窗底色：token 单源派生（themeSystems 既定消费方式：建窗注入 + 全窗 setBackgroundColor）。
 *  system 模式依赖 themeSource 已先行设置（boot 恢复或切换时同步），shouldUseDarkColors 才反映正确解析 */
export function themeWindowBackground(): string {
  const { systemId, mode } = getThemeState()
  return themeBoardBackground(systemId, resolveThemeMode(mode, nativeTheme.shouldUseDarkColors))
}

/** 全窗刷底色：主题变化后 resize/overscroll 不露出旧色 */
function refreshWindowBackgrounds(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(themeWindowBackground())
  }
}

/** 主题变更推送：各窗 store 跟随（issue 2026-10-06-theme-no-cross-window-sync）。
 *  含发起窗（直写幂等）；系统翻转不需要——各窗 matchMedia 各自感知 */
function broadcastThemeChange(): void {
  const { systemId, mode } = getThemeState()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.themeChanged, { systemId, mode })
  }
}

/** boot 恢复（建窗前调用）：读 theme.json → nativeTheme 先行——窗口第一帧三灯与底色即正确 */
export async function restoreTheme(): Promise<void> {
  await loadThemeState()
  nativeTheme.themeSource = getThemeState().mode
  // 跟随系统时系统翻转：三灯由系统天然跟随，主进程只补窗口底色
  nativeTheme.on('updated', () => {
    if (getThemeState().mode === 'system') refreshWindowBackgrounds()
  })
}

export function registerThemeIpc(): void {
  // sync 通道不可用 handle：on + returnValue。应答全内存、无磁盘 IO——preload 加载时
  // sendSync 取初值，renderer 首帧零闪的关键
  ipcMain.on(IPC_CHANNELS.themeGetSync, (event) => {
    event.returnValue = getThemeState()
  })

  ipcMain.handle(IPC_CHANNELS.themeSetMode, async (_event, mode: unknown): Promise<void> => {
    if (!isThemeMode(mode)) throw new Error(`${IPC_CHANNELS.themeSetMode}: 非法的 mode`)
    updateThemeState({ mode })
    // 原生三灯与页面采用同一外观，避免深色失焦控件融入浅色板头
    nativeTheme.themeSource = mode
    refreshWindowBackgrounds()
    broadcastThemeChange()
    // 落盘失败 → invoke reject（renderer 侧记录）：内存与原生已更新，降级为本次会话生效
    await persistThemeState()
  })

  ipcMain.handle(
    IPC_CHANNELS.themeSetSystemId,
    async (_event, systemId: unknown): Promise<void> => {
      if (!isThemeSystemId(systemId)) {
        throw new Error(`${IPC_CHANNELS.themeSetSystemId}: 非法的 systemId`)
      }
      updateThemeState({ systemId })
      refreshWindowBackgrounds()
      broadcastThemeChange()
      await persistThemeState()
    }
  )
}
