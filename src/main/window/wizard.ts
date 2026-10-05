import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { appIcon } from '../app-icon'

// 新建设备独立窗口单例（2026-10-06 用户确认由模态改非模态，plan
// 2026-10-06-wizard-independent-window）：可移动、不阻塞主窗输入；
// parent 保留层级跟随。主窗重复点「新建设备」= 聚焦既有窗而非再开一扇。
let wizardWindow: BrowserWindow | null = null
// open 互斥（issue 2026-10-04-wizard-window-singleton-race）：new 与 ready-to-show
// 之间的窗口期里并发 open 都会看到引用为空而各建一扇——opening 标记收口同轮只建一扇
let opening = false

const isWizardSender = (window: BrowserWindow | null): boolean =>
  window !== null && window === wizardWindow

/** devices 域 sender 守卫用：仅向导窗有权发起创建 */
export function wizardOwns(sender: Electron.WebContents): boolean {
  return isWizardSender(BrowserWindow.fromWebContents(sender))
}

/** 主窗关闭时带走向导窗（非模态子窗不随父窗自动销毁——与模态的行为差异点） */
export function closeWizardWindow(): void {
  if (wizardWindow !== null && !wizardWindow.isDestroyed()) {
    wizardWindow.close()
  }
}

export function openWizardWindow(parent: BrowserWindow): void {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.focus()
    return
  }
  // 已在开（本轮 ready-to-show 未到）：静默返回，窗随本轮一起 show + focus
  if (opening) return
  opening = true
  // 两页向导（plan 设计 3）：900×680 可缩放；最小尺寸按布局两栏 + 摘要不换行验证。
  // modal: false —— 独立可移动窗口，主窗保持可交互（plan 设计 1）
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 860,
    minHeight: 620,
    parent,
    modal: false,
    show: false,
    title: '新建设备',
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

  // 父窗主动关闭时由主窗侧调 closeWizardWindow 带走；这里只清引用防悬挂
  // （含 opening 复位——加载失败没有 ready-to-show 时靠关闭兜底解除互斥）
  window.on('closed', () => {
    wizardWindow = null
    opening = false
  })
  window.once('ready-to-show', () => {
    window.show()
    window.focus()
    opening = false
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/wizard.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/wizard.html'))
  }
  wizardWindow = window
}

export function registerWizardIpc(): void {
  ipcMain.handle(IPC_CHANNELS.wizardOpen, (event): void => {
    // 窗口归属发起调用的窗（当前只有主窗会调）；sender 不可信，宁可解析失败也不盲开
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) throw new Error(`${IPC_CHANNELS.wizardOpen}: 无法定位父窗`)
    openWizardWindow(parent)
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
