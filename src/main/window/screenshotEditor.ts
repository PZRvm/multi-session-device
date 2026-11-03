import { BrowserWindow, screen, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'
import { themeWindowBackground } from '../theme'
import { msg } from '../locale'

// 截图编辑窗控制器（plan 2026-11-02-screenshot-editor T3）：设备单例 Map 登记编辑窗
// 生命周期——与 settings/logcat 的全局单例差异在多设备并行编辑（一设备一窗）。
// 会话模式（ready/settled/result、15s 超时、did-fail-load、render-process-gone 就绪
// 前后双路径、迟到事件代次守卫）沿本项目 settings.ts 先例；窗口尺寸自适应算法迁自
// multi-session-browser captureEditorWindow（锚点常量原值）：
// 可用区 = 主屏工作区四周留边（高度另扣工具栏预留），显示缩放系数 = min(1, 可用宽/
// 图宽, 可用高/图高)——只缩不放；窗度量 = 画布显示尺寸 + 工具栏预留（useContentSize：
// 度量即内容区，系统框 chrome 不占预算）。scale/imgWidth/imgHeight 仅编辑窗显示层
// 消费（建窗 query 传显示值），导出链不缩放（导出 pixelRatio 由编辑窗按图像像素/
// 显示尺寸换算，契约 CaptureEditImagePayload 头注）。空缓存开窗无图可依，用默认
// 度量且不携尺寸 query（空态错误由编辑窗取图时如实呈现）。
// darwin 沿用 hiddenInset，三灯按编辑工具栏实际高度居中；sandbox 沿本项目 true。

/** 主屏工作区四周留边（工具栏与窗体 chrome 余量一并兜住；迁自来源原值） */
const WORK_AREA_MARGIN = 80
/** 窗高在画布显示区之外的工具栏/产出钮预留行（迁自来源原值） */
const TOOLBAR_ALLOWANCE = 56
/** 度量下限：极小图（裁剪产物再编辑）仍保可用工具条 */
const MIN_WINDOW_WIDTH = 720
const MIN_WINDOW_HEIGHT = 280
/** 空缓存开窗（无图可依）缺省度量 */
const DEFAULT_WINDOW_WIDTH = 800
const DEFAULT_WINDOW_HEIGHT = 520
/** 就绪超时（settings/logcat 同款口径） */
const READY_TIMEOUT_MS = 15_000

interface EditorSession {
  window: BrowserWindow | null
  ready: boolean
  settled: boolean
  result: Promise<void>
}

/** 设备 → 编辑窗会话登记：open 的单例判据与编辑通道 sender 归属（权限单源——
 *  归属从登记表解析，不信 renderer 自报）都读这张表 */
const sessions = new Map<string, EditorSession>()

/** 关闭全部编辑窗（主窗 closed 级联 / 测试清理用；无窗 no-op，引用由 closed 钩子自清） */
export function closeAllScreenshotEditorWindows(): void {
  for (const session of sessions.values()) {
    const window = session.window
    if (window && !window.isDestroyed()) window.close()
  }
}

/** 编辑窗 sender → 绑定设备 id（screenshot 域编辑通道注入判据）；未登记/已销毁 null */
export function screenshotEditorDeviceId(sender: WebContents): string | null {
  for (const [deviceId, session] of sessions) {
    const window = session.window
    if (window && !window.isDestroyed() && window.webContents === sender) return deviceId
  }
  return null
}

/** 打开/聚焦该设备的编辑窗（幂等单例）：已存在未销毁则（就绪后）聚焦并返回既有
 *  结果，否则建窗（ready-to-show 后显窗取焦）。imageWidth/imageHeight 为该设备
 *  缓存现图像素尺寸（尺寸自适应入参，缺省走默认度量——调用方截图域读缓存现取，
 *  空缓存不携） */
export function openScreenshotEditorWindow(
  deviceId: string,
  options?: { imageWidth: number; imageHeight: number }
): Promise<void> {
  const current = sessions.get(deviceId)
  if (current && !current.window?.isDestroyed()) {
    if (current.ready && current.window) {
      if (current.window.isMinimized()) current.window.restore()
      current.window.focus()
    }
    return current.result
  }

  let resolve!: () => void
  let reject!: (error: Error) => void
  const session: EditorSession = {
    window: null,
    ready: false,
    settled: false,
    result: new Promise<void>((done, failed) => {
      resolve = done
      reject = failed
    })
  }
  // 构造前保留会话；迟到事件只释放自己的代次
  sessions.set(deviceId, session)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const release = (): void => {
    if (sessions.get(deviceId) === session) sessions.delete(deviceId)
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
        msg('loadScreenshotEditorFailed', {
          detail: cause instanceof Error ? cause.message : String(cause)
        })
      )
    )
    release()
    if (session.window && !session.window.isDestroyed()) session.window.destroy()
  }

  try {
    // 尺寸自适应（头注算法）：query 只携显示值，权限与数据不走 renderer 自报
    let width = DEFAULT_WINDOW_WIDTH
    let height = DEFAULT_WINDOW_HEIGHT
    const query: Record<string, string> = {}
    if (options && options.imageWidth > 0 && options.imageHeight > 0) {
      const work = screen.getPrimaryDisplay().workAreaSize
      const availWidth = Math.max(1, work.width - WORK_AREA_MARGIN * 2)
      const availHeight = Math.max(1, work.height - WORK_AREA_MARGIN * 2 - TOOLBAR_ALLOWANCE)
      const scale = Math.min(1, availWidth / options.imageWidth, availHeight / options.imageHeight)
      width = Math.max(MIN_WINDOW_WIDTH, Math.round(options.imageWidth * scale))
      height = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.round(options.imageHeight * scale) + TOOLBAR_ALLOWANCE
      )
      query['scale'] = String(scale)
      query['imgWidth'] = String(options.imageWidth)
      query['imgHeight'] = String(options.imageHeight)
    }

    const window = new BrowserWindow({
      width,
      height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      useContentSize: true,
      show: false,
      backgroundColor: themeWindowBackground(),
      title: msg('screenshotEditorWindowTitle'),
      icon: appIcon,
      // 初始按 48px 工具栏居中，换行后由 renderer 上报高度更新原生三灯。
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 16 } }
        : {}),
      resizable: true,
      autoHideMenuBar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
    })
    session.window = window
    if (process.platform === 'darwin') {
      // 通道只属于这个编辑窗；不允许子 frame 或其他窗口调整它的按钮。
      window.webContents.ipc.on(
        IPC_CHANNELS.screenshotEditorToolbarHeight,
        (event, height: unknown) => {
          if (
            window.isDestroyed() ||
            event.senderFrame !== window.webContents.mainFrame ||
            typeof height !== 'number' ||
            !Number.isFinite(height) ||
            height < 47.5
          ) {
            return
          }
          // DOM 上报 CSS px；原生位置和窗高度量为 DIP，缩放因子只信本窗 webContents。
          const toolbarHeight = height * window.webContents.getZoomFactor()
          if (toolbarHeight > window.getContentBounds().height + 0.5) return
          // 原生灯中心比 position.y 低约 8px；容纳尺寸换算的亚像素误差。
          window.setWindowButtonPosition({
            x: 14,
            y: Math.max(0, Math.round(toolbarHeight / 2 - 8))
          })
        }
      )
    }
    window.on('page-title-updated', (event) => event.preventDefault())
    window.on('closed', () => {
      settle()
      release()
    })
    window.once('ready-to-show', () => {
      if (sessions.get(deviceId) !== session || session.settled || window.isDestroyed()) return
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
      // 就绪前崩溃走加载失败收口（reject 给 open 调用方）；就绪后崩溃（settings
      // 2026-10-10 P2 同款）：settled 已置位，fail 早退不释放——死窗留在登记上，
      // 再点只聚焦残窗。改为释放登记并销毁残窗，下次 open 重建
      if (session.ready || session.settled) {
        release()
        if (!window.isDestroyed()) window.destroy()
        return
      }
      fail(new Error(msg('wizardRendererExit', { reason: details.reason })))
    })
    timeout = setTimeout(() => fail(new Error(msg('wizardLoadTimeout'))), READY_TIMEOUT_MS)
    const search = new URLSearchParams(query).toString()
    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(
            `${process.env['ELECTRON_RENDERER_URL']}/screenshot-editor.html${search ? `?${search}` : ''}`
          )
        : window.loadFile(join(__dirname, '../renderer/screenshot-editor.html'), {
            query: Object.keys(query).length > 0 ? query : undefined
          })
    void load.catch(fail)
  } catch (error) {
    fail(error)
  }
  return session.result
}
