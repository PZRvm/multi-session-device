import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { getMainWindow } from './index'
import { msg } from '../locale'

interface SettingsSession {
  window: BrowserWindow | null
  ready: boolean
  settled: boolean
  result: Promise<void>
}

let settingsSession: SettingsSession | null = null

export function closeSettingsWindow(): void {
  const window = settingsSession?.window
  if (window && !window.isDestroyed()) window.close()
}

export function openSettingsWindow(): Promise<void> {
  const current = settingsSession
  if (current && !current.window?.isDestroyed()) {
    if (current.ready) current.window?.focus()
    return current.result
  }

  let resolve!: () => void
  let reject!: (error: Error) => void
  const session: SettingsSession = {
    window: null,
    ready: false,
    settled: false,
    result: new Promise<void>((done, failed) => {
      resolve = done
      reject = failed
    })
  }
  // 构造前保留会话；迟到事件只释放自己的代次。
  settingsSession = session
  let timeout: ReturnType<typeof setTimeout> | undefined
  const release = (): void => {
    if (settingsSession === session) settingsSession = null
  }
  const settle = (error?: Error): void => {
    if (session.settled) return
    session.settled = true
    clearTimeout(timeout)
    if (error) reject(error)
    else resolve()
  }
  const fail = (cause: unknown): void => {
    if (session.settled) return
    settle(
      new Error(
        msg('loadSettingsFailed', {
          detail: cause instanceof Error ? cause.message : String(cause)
        })
      )
    )
    release()
    if (session.window && !session.window.isDestroyed()) session.window.destroy()
  }

  try {
    const window = new BrowserWindow({
      width: 760,
      height: 560,
      minWidth: 640,
      minHeight: 460,
      show: false,
      backgroundColor: themeWindowBackground(),
      title: msg('settingsWindowTitle'),
      icon: appIcon,
      // darwin 用原生三灯（向导窗同款 hiddenInset 度量；对齐姊妹仓库设置窗模式）：
      // 灯归系统自管且无逐灯隐藏 API，最小化/全屏能力禁用后黄/绿为无效按钮，仅红灯关窗
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
        : {}),
      resizable: true,
      minimizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
    })
    session.window = window
    window.on('page-title-updated', (event) => event.preventDefault())
    window.on('closed', () => {
      settle()
      release()
    })
    window.once('ready-to-show', () => {
      if (settingsSession !== session || session.settled || window.isDestroyed()) return
      session.ready = true
      settle()
      window.show()
      window.focus()
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) fail(new Error(`${description}（${code}）`))
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      fail(new Error(msg('wizardRendererExit', { reason: details.reason })))
    })
    timeout = setTimeout(() => fail(new Error(msg('wizardLoadTimeout'))), 15_000)
    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
        : window.loadFile(join(__dirname, '../renderer/settings.html'))
    void load.catch(fail)
  } catch (error) {
    fail(error)
  }
  return session.result
}

export function registerSettingsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.settingsOpen, (event): Promise<void> => {
    if (getMainWindow()?.webContents !== event.sender) {
      throw new Error(`${IPC_CHANNELS.settingsOpen}: ${msg('settingsMainOnlySuffix')}`)
    }
    return openSettingsWindow()
  })
}
