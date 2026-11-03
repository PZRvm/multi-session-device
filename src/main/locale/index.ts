import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { ERRORS_COPY, format, isSettingsLocale, type ErrorsCopy } from '@shared/i18n'
import { getLocaleState, loadLocaleState, persistLocaleState, updateLocaleState } from './store'

/** 主进程可见文案取词：按当前内存 locale 格式化 errors 域模板（boot 前调用 = zh-CN 缺省）。
 *  外部工具原样输出（adb/emulator stderr）不走这里——前缀可译、正文保留 */
export const msg = (key: keyof ErrorsCopy, params?: Record<string, string | number>): string =>
  format(ERRORS_COPY[getLocaleState()][key], params)

/** boot 恢复（建窗前调用）：读 locale.json → 内存态。无建窗参数依赖（对比主题的
 *  nativeTheme 与底色），但先于建窗保证主进程首条可见文案即正确语言 */
export async function restoreLocale(): Promise<void> {
  await loadLocaleState()
}

/** 语言变更推送：各窗 store 直写跟随（沿 theme:changed 先例）。含发起窗（直写幂等） */
function broadcastLocaleChange(): void {
  const payload = { locale: getLocaleState() }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.localeChanged, payload)
  }
}

export function registerLocaleIpc(): void {
  // sync 通道不可用 handle：on + returnValue。应答全内存、无磁盘 IO——preload 加载时
  // sendSync 取初值（沿 theme 先例）
  ipcMain.on(IPC_CHANNELS.localeGetSync, (event) => {
    event.returnValue = { locale: getLocaleState() }
  })

  ipcMain.handle(IPC_CHANNELS.localeSet, async (_event, locale: unknown): Promise<void> => {
    if (!isSettingsLocale(locale))
      throw new Error(`${IPC_CHANNELS.localeSet}: ${msg('invalidLocaleSuffix')}`)
    updateLocaleState(locale)
    broadcastLocaleChange()
    // 落盘失败 → invoke reject（renderer 侧记录）：内存已更新，降级为本次会话生效
    await persistLocaleState()
  })
}
