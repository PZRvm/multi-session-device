import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { WizardContext } from '@shared/types'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { getMainWindow } from './index'

// 新建设备独立窗口单例（2026-10-06 用户确认由模态改非模态，plan
// 2026-10-06-wizard-independent-window）：可移动、不阻塞主窗输入。
// 无 parent（追加轮五）：macOS child window 会跟随父窗移动且层级锁在父窗之上，
// 用户要真独立；主窗关闭带走向导靠 index.ts closed 里的显式 closeWizardWindow。
// 主窗重复点「新建设备」= 聚焦既有窗而非再开一扇。
interface WizardSession {
  window: BrowserWindow | null
  context: WizardContext
  ready: boolean
  settled: boolean
  result: Promise<void>
}

// 先保留本轮，再构造窗口；所有事件都只收口自己的代次。
let wizardSession: WizardSession | null = null
const LOAD_TIMEOUT_MS = 15_000

const contextLabel = (context: WizardContext): string =>
  context.kind === 'create' ? '新建设备' : '编辑设备'

const sameContext = (a: WizardContext, b: WizardContext): boolean =>
  a.kind === b.kind && (a.kind !== 'edit' || b.kind !== 'edit' || a.deviceId === b.deviceId)

const isWizardSender = (window: BrowserWindow | null): boolean =>
  window !== null && window === wizardSession?.window

/** devices 域 sender 守卫用：仅向导窗有权发起创建 */
export function wizardOwns(sender: Electron.WebContents): boolean {
  return isWizardSender(BrowserWindow.fromWebContents(sender))
}

/** 向导窗读取自己的固定上下文；非向导窗返回 null */
export function wizardContextOf(sender: Electron.WebContents): WizardContext | null {
  return isWizardSender(BrowserWindow.fromWebContents(sender)) ? wizardSession!.context : null
}

/** 主窗关闭时带走向导窗（非模态子窗不随父窗自动销毁——与模态的行为差异点） */
export function closeWizardWindow(): void {
  const window = wizardSession?.window
  if (window && !window.isDestroyed()) window.close()
}

export function openWizardWindow(context: WizardContext = { kind: 'create' }): Promise<void> {
  const current = wizardSession
  if (current && !current.window?.isDestroyed()) {
    if (current.ready) current.window?.focus()
    if (!sameContext(current.context, context)) {
      return Promise.reject(
        new Error(
          `已有「${contextLabel(current.context)}」窗口打开，请先关闭它再打开「${contextLabel(context)}」`
        )
      )
    }
    return current.result
  }

  let resolve!: () => void
  let reject!: (error: Error) => void
  const session: WizardSession = {
    window: null,
    context: { ...context },
    ready: false,
    settled: false,
    result: new Promise<void>((done, failed) => {
      resolve = done
      reject = failed
    })
  }
  wizardSession = session
  let timeout: ReturnType<typeof setTimeout> | undefined
  const release = (): void => {
    if (wizardSession === session) wizardSession = null
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
    const detail = cause instanceof Error ? cause.message : String(cause)
    settle(new Error(`加载「${contextLabel(session.context)}」窗口失败：${detail}`))
    release()
    if (session.window && !session.window.isDestroyed()) session.window.destroy()
  }

  try {
    // 两页向导（plan 设计 3）：900×680 可缩放；最小尺寸按布局两栏 + 摘要不换行验证。
    // 独立可移动窗口，主窗保持可交互（plan 设计 1）——不设 parent：设了即成为 macOS
    // child window，会跟随父窗移动且层级锁在父窗之上（追加轮五用户裁决要真独立）
    const window = new BrowserWindow({
      width: 900,
      height: 680,
      minWidth: 860,
      minHeight: 620,
      show: false,
      // 与主窗同源：向导窗首帧也是主题板面底
      backgroundColor: themeWindowBackground(),
      title: contextLabel(context),
      icon: appIcon,
      // darwin 去原生标题条、三灯嵌入。y=12 实测居中：灯 12px 高且 Electron 有 +2 内禀偏移
      // （code y → 实际顶 y+2，中心 y+8）→ y=12 时中心 19.5 = 40px 板头中心 = 标题组中心，三者共线
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
        : {}),
      resizable: true,
      minimizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })

    session.window = window
    window.on('closed', () => {
      // 关闭是主动取消；已经失败/就绪的结果不会再次结算。
      settle()
      release()
    })
    window.once('ready-to-show', () => {
      if (wizardSession !== session || session.settled || window.isDestroyed()) return
      session.ready = true
      settle()
      window.show()
      window.focus()
    })
    window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) fail(new Error(`${description}（${code}）`))
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      fail(new Error(`渲染进程退出（${details.reason}）`))
    })
    timeout = setTimeout(() => fail(new Error('15 秒内未完成窗口加载，请重试')), LOAD_TIMEOUT_MS)

    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/wizard.html`)
        : window.loadFile(join(__dirname, '../renderer/wizard.html'))
    void load.catch(fail)
  } catch (error) {
    fail(error)
  }
  return session.result
}

/** 向导窗 IPC 的可选接线（装配层提供）：开编辑窗前核验目标设备可编辑 */
export interface WizardIpcDeps {
  assertEditorTarget?: (deviceId: string) => Promise<void>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerWizardIpc(deps: WizardIpcDeps = {}): void {
  ipcMain.handle(IPC_CHANNELS.wizardOpen, (event): Promise<void> => {
    // sender 守卫保留（不可信，宁可解析失败也不盲开）；parent 已移除——向导窗完全独立
    if (!BrowserWindow.fromWebContents(event.sender)) {
      throw new Error(`${IPC_CHANNELS.wizardOpen}: 无法定位调用方窗口`)
    }
    return openWizardWindow()
  })

  // 主窗开编辑窗（plan 2026-10-08 设计 1）：仅主窗可调；目标设备由 devices 域核验
  ipcMain.handle(IPC_CHANNELS.wizardOpenEditor, async (event, raw: unknown): Promise<void> => {
    if (getMainWindow()?.webContents.id !== event.sender.id) {
      throw new Error(`${IPC_CHANNELS.wizardOpenEditor}: 仅主窗可打开编辑窗`)
    }
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as Record<string, unknown>).id !== 'string' ||
      !UUID_RE.test((raw as Record<string, unknown>).id as string)
    ) {
      throw new Error(`${IPC_CHANNELS.wizardOpenEditor}: 非法的设备标识`)
    }
    const deviceId = (raw as { id: string }).id
    if (deps.assertEditorTarget) await deps.assertEditorTarget(deviceId)
    await openWizardWindow({ kind: 'edit', deviceId })
  })

  // 登记窗口读取自己的上下文（渲染层据此路由创建/编辑页）
  ipcMain.handle(IPC_CHANNELS.wizardContext, (event): WizardContext | null => {
    const context = wizardContextOf(event.sender)
    if (context === null) {
      throw new Error(`${IPC_CHANNELS.wizardContext}: 非向导窗调用`)
    }
    return context
  })

  ipcMain.handle(IPC_CHANNELS.wizardClose, (event): void => {
    const sender = BrowserWindow.fromWebContents(event.sender)
    // 只允许向导窗关自己——别的窗发 close 予以拒绝
    if (!isWizardSender(sender)) {
      throw new Error(`${IPC_CHANNELS.wizardClose}: 非向导窗调用`)
    }
    sender?.close()
  })
}
