import { ipcMain, nativeTheme } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export function registerThemeIpc(): void {
  ipcMain.handle(IPC_CHANNELS.themeSetMode, (_event, mode: unknown): void => {
    if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
      throw new Error(`${IPC_CHANNELS.themeSetMode}: 非法的 mode`)
    }
    // 原生三灯与页面采用同一外观，避免深色失焦控件融入浅色板头。
    nativeTheme.themeSource = mode
  })
}
