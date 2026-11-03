import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { getMainWindow } from './index'
import { msg } from '../locale'

interface LogcatSession {
  window: BrowserWindow | null
  ready: boolean
  settled: boolean
  result: Promise<void>
}

let logcatSession: LogcatSession | null = null

export function closeLogcatWindow(): void {
  const window = logcatSession?.window
  if (window && !window.isDestroyed()) window.close()
}

/** 日志窗 sender 判定（logcat 域上下文通道守卫注入用） */
export function isLogcatWindowSender(sender: WebContents): boolean {
  const window = logcatSession?.window
  return window != null && !window.isDestroyed() && window.webContents === sender
}

export function openLogcatWindow(deviceId?: string): Promise<void> {
  const current = logcatSession
  if (current && !current.window?.isDestroyed()) {
    if (current.ready) current.window?.focus()
    return current.result
  }

  let resolve!: () => void
  let reject!: (error: Error) => void
  const session: LogcatSession = {
    window: null,
    ready: false,
    settled: false,
    result: new Promise<void>((done, failed) => {
      resolve = done
      reject = failed
    })
  }
  // 构造前保留会话；迟到事件只释放自己的代次。
  logcatSession = session
  let timeout: ReturnType<typeof setTimeout> | undefined
  const release = (): void => {
    if (logcatSession === session) logcatSession = null
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
        msg('loadLogcatFailed', {
          detail: cause instanceof Error ? cause.message : String(cause)
        })
      )
    )
    release()
    if (session.window && !session.window.isDestroyed()) session.window.destroy()
  }

  try {
    const window = new BrowserWindow({
      width: 560,
      height: 640,
      minWidth: 400,
      minHeight: 360,
      show: false,
      backgroundColor: themeWindowBackground(),
      title: msg('logcatWindowTitle'),
      icon: appIcon,
      // darwin 原生三灯（设置窗同款 hiddenInset 度量）：黄/绿禁用后仅红灯关窗
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
      if (logcatSession !== session || session.settled || window.isDestroyed()) return
      session.ready = true
      // 独立窗出现 ⇒ 主窗 dock 必然收起（renderer 随后 setLogDockOpen(false)）——
      // main 侧先解除宽钳制，保证独立窗口态主窗宽度自由，不依赖 renderer 解锁时序
      dockMinWidth = 0
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
    // 弹出时带上 dock 当前设备（?device=<id>）：日志窗起步即对准目标，无参则首个 running
    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(
            `${process.env['ELECTRON_RENDERER_URL']}/logcat.html${deviceId ? `?device=${encodeURIComponent(deviceId)}` : ''}`
          )
        : window.loadFile(join(__dirname, '../renderer/logcat.html'), {
            query: deviceId ? { device: deviceId } : undefined
          })
    void load.catch(fail)
  } catch (error) {
    fail(error)
  }
  return session.result
}

// dock 展开态的最小宽钳制：不用 setMinimumSize——macOS 上 (0,0) 恢复存在窗口
// 服务器时序竞态（偶发不清除，主窗从此缩不小）；will-resize 钳制是纯同步逻辑，
// 解除 = 变量置零，无竞态。程序化 setSize/setBounds 不触发 will-resize，拉宽不受影响。
// 宽度口径：minWidth 是 renderer 按内容宽算的需求，比较与拉宽必须走 getContentBounds/
// setContentSize——getBounds 是外框，Windows 帧差约 14-16px，用外框对比内容需求会
// 少拉帧差宽度，内容宽不足导致 dock 不渲染且再点不再拉宽（issue P2-1）
let dockMinWidth = 0
/** 已挂钳制钩子的主窗 id——主窗关闭重开（macOS activate 重建）后按新窗重挂 */
let resizeHookWindowId = -1

const attachDockResizeHook = (): void => {
  const window = getMainWindow()
  if (!window || window.id === resizeHookWindowId) return
  resizeHookWindowId = window.id
  // 用户拖拽：will-resize 预阻止（无闪跳；macOS 支持）。newBounds 是外框尺寸，
  // 折算内容宽再比——帧差 = 当前外框宽 − 内容宽（分数缩放下可能带 .5，整数宽下不影响判定）
  window.on('will-resize', (event, newBounds) => {
    if (dockMinWidth <= 0) return
    const frameDelta = window.getBounds().width - window.getContentBounds().width
    if (newBounds.width - frameDelta < dockMinWidth) {
      event.preventDefault()
    }
  })
  // 程序化 setBounds/resizeTo（含窗口服务器异常路径）：事后回弹钳制——
  // 回到 min 后不再小于阈值，无递归。尺寸取整：macOS 分数缩放下 bounds
  // 常返回 .5 值，setContentSize 只收整数（否则 native 参数转换失败抛错）
  window.on('resize', () => {
    if (dockMinWidth <= 0 || window.isDestroyed()) return
    const content = window.getContentBounds()
    if (content.width < dockMinWidth) {
      window.setContentSize(Math.round(dockMinWidth), Math.round(content.height))
    }
  })
}

export function registerLogcatIpc(): void {
  ipcMain.handle(IPC_CHANNELS.logcatWindowOpen, (event, raw: unknown): Promise<void> => {
    if (getMainWindow()?.webContents !== event.sender) {
      throw new Error(`${IPC_CHANNELS.logcatWindowOpen}: ${msg('logcatMainOnlySuffix')}`)
    }
    const { deviceId } = (raw ?? {}) as { deviceId?: string }
    if (deviceId !== undefined && typeof deviceId !== 'string') {
      throw new Error(`${IPC_CHANNELS.logcatWindowOpen}: ${msg('logcatInvalidPayloadSuffix')}`)
    }
    return openLogcatWindow(deviceId)
  })
  // 独立窗开着时主窗点击入口 = 聚焦而非重开 dock——状态由主窗在点击时查询
  ipcMain.handle(IPC_CHANNELS.logcatWindowState, (event): boolean => {
    if (getMainWindow()?.webContents !== event.sender) {
      throw new Error(`${IPC_CHANNELS.logcatWindowState}: ${msg('logcatMainOnlySuffix')}`)
    }
    const window = logcatSession?.window
    return window != null && !window.isDestroyed() && logcatSession?.ready === true
  })
  // 贴回：关日志窗并让主窗重新展开 dock（先广播后关窗，renderer 先收到再退订）
  ipcMain.handle(IPC_CHANNELS.logcatDockBack, (event): Promise<void> => {
    if (!isLogcatWindowSender(event.sender)) {
      throw new Error(`${IPC_CHANNELS.logcatDockBack}: ${msg('logcatWindowOnlySuffix')}`)
    }
    getMainWindow()?.webContents.send(IPC_CHANNELS.logcatDockBack)
    closeLogcatWindow()
    return Promise.resolve()
  })
  // dock 展开态同步：展开时锁主窗 minWidth（dock 不会被窗口缩窄挤掉），
  // 窗口不够宽则拉宽到 minWidth（窄窗点入口 = 黏滞右侧而非退化独立窗）；收起解锁
  ipcMain.handle(IPC_CHANNELS.logcatDockState, (event, raw: unknown): Promise<void> => {
    const window = getMainWindow()
    if (window?.webContents !== event.sender) {
      throw new Error(`${IPC_CHANNELS.logcatDockState}: ${msg('logcatMainOnlySuffix')}`)
    }
    const { expanded, minWidth } = (raw ?? {}) as { expanded?: boolean; minWidth?: number }
    if (expanded !== true && expanded !== false) {
      throw new Error(`${IPC_CHANNELS.logcatDockState}: ${msg('logcatInvalidPayloadSuffix')}`)
    }
    if (expanded) {
      if (typeof minWidth !== 'number' || !Number.isFinite(minWidth) || minWidth <= 0) {
        throw new Error(`${IPC_CHANNELS.logcatDockState}: ${msg('logcatInvalidPayloadSuffix')}`)
      }
      attachDockResizeHook()
      dockMinWidth = Math.round(minWidth)
      // 比较与拉宽都在内容坐标：外框帧差不参与（else 内容宽不足，dock 不渲染）
      const content = window.getContentBounds()
      if (content.width < minWidth) {
        window.setContentSize(Math.round(minWidth), Math.round(content.height))
      }
    } else {
      dockMinWidth = 0
    }
    return Promise.resolve()
  })
}
