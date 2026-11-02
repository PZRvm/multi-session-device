import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { AboutInfo } from '@shared/types'
import { appIcon } from '../app-icon'
import { registerWindowTitleBar, themeWindowBackground, themeWindowTitleBarOverlay } from '../theme'
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

/** 设置窗 sender 判定（SDK 来源域等仅设置窗可调的通道守卫；沿 wizardOwns 先例） */
export function settingsOwns(sender: Electron.WebContents): boolean {
  const window = settingsSession?.window
  return (
    window !== null &&
    window !== undefined &&
    !window.isDestroyed() &&
    window.webContents === sender
  )
}

export function openSettingsWindow(): Promise<void> {
  const current = settingsSession
  if (current && !current.window?.isDestroyed()) {
    if (current.ready && current.window) {
      if (current.window.isMinimized()) current.window.restore()
      current.window.focus()
    }
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
        : process.platform === 'win32'
          ? {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: themeWindowTitleBarOverlay(),
              maximizable: true
            }
          : {}),
      resizable: true,
      minimizable: process.platform === 'win32',
      fullscreenable: false,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
    })
    session.window = window
    if (process.platform === 'win32') registerWindowTitleBar(window)
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
      // 就绪前崩溃走加载失败收口（reject 给 open 调用方）；就绪后崩溃（issue
      // 2026-10-10-settings-window-crash-reopen P2）：settled 已置位，fail 早退
      // 不释放——死窗留在单例上，齿轮再点只聚焦残窗。改为释放单例并销毁残窗，
      // 下次 openSettingsWindow 重建。
      if (session.ready || session.settled) {
        release()
        if (!window.isDestroyed()) window.destroy()
        return
      }
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

  // 关于页真值（版本三件套 + 数据目录）：静态快照，拉一次即够；仅设置窗可调
  ipcMain.handle(IPC_CHANNELS.aboutGet, (event): AboutInfo => {
    if (!settingsOwns(event.sender)) {
      throw new Error(`${IPC_CHANNELS.aboutGet}${msg('settingsCallerNotAllowed')}`)
    }
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? null,
      chromiumVersion: process.versions.chrome ?? null,
      dataDirectory: app.getPath('userData')
    }
  })

  // 打开数据目录：路径由 main 单源（userData），无载荷可伪造；openPath 失败是
  // 用户可重试的轻操作，不回传 renderer，两种失败形态（resolve 错误串 / reject）
  // 都控制台留痕；两参 then 让链上任何一环都不产生 unhandled rejection
  ipcMain.handle(IPC_CHANNELS.aboutOpenDataDirectory, (event): void => {
    if (!settingsOwns(event.sender)) {
      throw new Error(`${IPC_CHANNELS.aboutOpenDataDirectory}${msg('settingsCallerNotAllowed')}`)
    }
    void shell.openPath(app.getPath('userData')).then(
      (failure) => {
        if (failure) console.warn(`[settings] openPath(userData): ${failure}`)
      },
      (error: unknown) => {
        console.warn(`[settings] openPath(userData): ${String(error)}`)
      }
    )
  })
}
