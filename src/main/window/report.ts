import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { getMainWindow } from './index'
import { msg } from '../locale'

interface ReportSession {
  window: BrowserWindow | null
  ready: boolean
  settled: boolean
  result: Promise<void>
}

let reportSession: ReportSession | null = null

/** 当前对账详情窗（无 / 已销毁 = null）——devices 域 sender 白名单用 */
export function getReportWindow(): BrowserWindow | null {
  const window = reportSession?.window
  return window !== null && window !== undefined && !window.isDestroyed() ? window : null
}

export function closeReportWindow(): void {
  const window = reportSession?.window
  if (window && !window.isDestroyed()) window.close()
}

/** 对账详情窗（plan 2026-10-12-reconcile-report-panel 子窗口方案）：单例、已开聚焦 */
export function openReportWindow(): Promise<void> {
  const current = reportSession
  if (current && !current.window?.isDestroyed()) {
    if (current.ready) current.window?.focus()
    return current.result
  }

  let resolve!: () => void
  let reject!: (error: Error) => void
  const session: ReportSession = {
    window: null,
    ready: false,
    settled: false,
    result: new Promise<void>((done, failed) => {
      resolve = done
      reject = failed
    })
  }
  reportSession = session
  let timeout: ReturnType<typeof setTimeout> | undefined
  const release = (): void => {
    if (reportSession === session) reportSession = null
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
        msg('loadReportWindowFailed', {
          detail: cause instanceof Error ? cause.message : String(cause)
        })
      )
    )
    release()
    if (session.window && !session.window.isDestroyed()) session.window.destroy()
  }

  try {
    const window = new BrowserWindow({
      width: 620,
      height: 520,
      minWidth: 480,
      minHeight: 380,
      show: false,
      backgroundColor: themeWindowBackground(),
      title: msg('reportWindowTitle'),
      icon: appIcon,
      resizable: true,
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
      if (reportSession !== session || session.settled || window.isDestroyed()) return
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
        ? window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/report.html`)
        : window.loadFile(join(__dirname, '../renderer/report.html'))
    void load.catch(fail)
  } catch (error) {
    fail(error)
  }
  return session.result
}

export function registerReportIpc(): void {
  ipcMain.handle(IPC_CHANNELS.reportWindowOpen, (event): Promise<void> => {
    // 主窗与摘要通知所在的主窗 webContents 发起；其他窗拒绝
    if (getMainWindow()?.webContents !== event.sender) {
      throw new Error(`${IPC_CHANNELS.reportWindowOpen}: ${msg('settingsMainOnlySuffix')}`)
    }
    return openReportWindow()
  })
}
