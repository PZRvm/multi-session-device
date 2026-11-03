import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { SettingsLocale } from '@shared/i18n'
import type { LocaleInitialState, LocaleSelection } from '@shared/types'

export const localeApi = {
  /** boot 初值：preload 加载时同步取一次（主进程内存应答，无磁盘 IO），renderer 首帧零闪的取值点 */
  initial: ipcRenderer.sendSync(IPC_CHANNELS.localeGetSync) as LocaleInitialState,
  set: (locale: SettingsLocale): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.localeSet, locale),
  /** 语言变更推送订阅（跨窗跟随），返回解绑函数 */
  onChanged: (callback: (selection: LocaleSelection) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, selection: LocaleSelection): void => {
      callback(selection)
    }
    ipcRenderer.on(IPC_CHANNELS.localeChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.localeChanged, listener)
    }
  }
}
