import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'

// 新建设备模态窗单例：主窗重复点「新建设备」= 聚焦既有窗而非再开一扇
let wizardWindow: BrowserWindow | null = null
// open 互斥（issue 2026-10-04-wizard-window-singleton-race）：new 与 ready-to-show
// 之间的窗口期里并发 open 都会看到引用为空而各建一扇——opening 标记收口同轮只建一扇
let opening = false

const isWizardSender = (window: BrowserWindow | null): boolean =>
  window !== null && window === wizardWindow

export function openWizardWindow(parent: BrowserWindow): void {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.focus()
    return
  }
  // 已在开（本轮 ready-to-show 未到）：静默返回，窗随本轮一起 show + focus
  if (opening) return
  opening = true
  const window = new BrowserWindow({
    width: 440,
    height: 560,
    parent,
    modal: true,
    show: false,
    title: '新建设备',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  // 父窗销毁时 Electron 会带走模态子窗；这里只清引用防悬挂（含 opening 复位——
  // 加载失败没有 ready-to-show 时靠关闭兜底解除互斥）
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
    // 模态归属发起调用的窗（当前只有主窗会调）；sender 不可信，宁可解析失败也不盲开
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
