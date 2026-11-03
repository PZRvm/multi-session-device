import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { RecordingCommand, RecordingSnapshot } from '@shared/recording'
import { appIcon } from '../app-icon'
import { RecordingManager, type RecordingDeps } from './manager'
import { recordingMsg as msg } from './copy'
import { RecordingPreferences } from './preferences'
import { createRecordingConfirm } from './prompts'
import { RecordingNotifications } from './notifications'

const notificationServices = new WeakMap<RecordingManager, RecordingNotifications>()
export const registerRecording = (
  deps: Pick<RecordingDeps, 'adbPath' | 'toolEnv' | 'scrcpy' | 'device'> & {
    isMainSender: (sender: Electron.WebContents) => boolean
    pushTarget: () => Electron.WebContents | null
    getMainWindow?: () => BrowserWindow | null
    isSettingsSender?: (sender: Electron.WebContents) => boolean
  }
): RecordingManager => {
  const preferences = new RecordingPreferences(
    join(app.getPath('userData'), 'recording-prompts.json')
  )
  const parent = (): BrowserWindow | null => {
    if (deps.getMainWindow) return deps.getMainWindow()
    const target = deps.pushTarget()
    return target ? BrowserWindow.fromWebContents(target) : null
  }
  const notifications = new RecordingNotifications({
    canShow: () => {
      const window = parent()
      return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
    },
    present: async (task) => {
      const window = parent()
      if (!window || window.isDestroyed() || !window.isVisible()) return undefined
      const saved = task.state === 'saved'
      const result = await dialog.showMessageBox(window, {
        type: saved ? 'info' : 'warning',
        message: msg(saved ? 'savedTitle' : 'failedTitle', { name: task.deviceName }),
        detail: [
          task.fileName,
          task.audio === 'silent' ? msg('silent') : '',
          task.interruption,
          task.error
        ]
          .filter(Boolean)
          .join('\n'),
        buttons: saved
          ? [msg('reveal'), msg('close')]
          : task.canRetry
            ? [msg('retry'), msg('later')]
            : [msg('later')],
        defaultId: saved || task.canRetry ? 1 : 0,
        cancelId: saved || task.canRetry ? 1 : 0,
        icon: appIcon
      })
      if (window.isDestroyed()) return undefined
      return saved
        ? result.response === 0
          ? 'reveal'
          : 'close'
        : task.canRetry && result.response === 0
          ? 'retry'
          : 'later'
    },
    command: (id, command) => manager.command(id, command),
    failed: async (error) => {
      const window = parent()
      if (window && !window.isDestroyed() && window.isVisible())
        await dialog.showMessageBox(window, {
          type: 'warning',
          message: msg('failed'),
          detail: error instanceof Error ? error.message : String(error),
          buttons: [msg('close')],
          icon: appIcon
        })
    }
  })
  const manager = new RecordingManager({
    ...deps,
    directory: join(app.getPath('userData'), 'recordings'),
    downloads: () => app.getPath('downloads'),
    confirm: createRecordingConfirm(preferences, parent),
    reveal: (path) => shell.showItemInFolder(path),
    changed: (snapshot) => {
      deps.pushTarget()?.send(IPC_CHANNELS.recordingChanged, snapshot)
      notifications?.update(snapshot)
    }
  })
  notificationServices.set(manager, notifications)
  app.once('will-quit', () => notifications?.dispose())
  void manager.ready().then(() => notifications?.update(manager.snapshot()))
  const authorize = (event: Electron.IpcMainInvokeEvent): void => {
    if (!deps.isMainSender(event.sender) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unauthorized recording window')
  }
  const text = (raw: unknown, key: string): string => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid recording payload')
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value !== 'string' || !value.length || value.length > 256)
      throw new Error('Invalid recording identifier')
    return value
  }
  ipcMain.handle(IPC_CHANNELS.recordingGet, async (event): Promise<RecordingSnapshot> => {
    authorize(event)
    await manager.ready()
    const snapshot = manager.snapshot()
    notifications?.update(snapshot)
    return snapshot
  })
  ipcMain.handle(IPC_CHANNELS.recordingResetPrompts, async (event): Promise<void> => {
    if (!deps.isSettingsSender?.(event.sender) || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unauthorized recording settings window')
    await preferences.reset()
  })
  ipcMain.handle(IPC_CHANNELS.recordingStart, async (event, raw): Promise<RecordingSnapshot> => {
    authorize(event)
    const id = text(raw, 'deviceId')
    await manager.ready()
    return manager.start(id)
  })
  ipcMain.handle(IPC_CHANNELS.recordingCommand, async (event, raw): Promise<RecordingSnapshot> => {
    authorize(event)
    const taskId = text(raw, 'taskId'),
      command = text(raw, 'command')
    if (!['pause', 'resume', 'stop', 'reveal', 'dismiss', 'retry'].includes(command))
      throw new Error('Invalid recording command')
    return manager.command(taskId, command as RecordingCommand)
  })
  return manager
}
export const confirmRecordingQuit = async (manager: RecordingManager): Promise<boolean> => {
  const notifications = notificationServices.get(manager)
  notifications?.pause(true)
  if (!manager.hasPending()) return true
  let leaving = false
  manager.setFrozen(true)
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: msg('quitTitle'),
      message: msg('quitMessage'),
      buttons: [msg('quitSave'), msg('quitStay'), msg('quitDiscard')],
      defaultId: 1,
      cancelId: 1,
      icon: appIcon
    })
    if (result.response === 1) return false
    if (result.response === 2) {
      await manager.discardForQuit()
      leaving = true
      return true
    }
    if (await manager.saveForQuit()) {
      leaving = true
      return true
    }
    await dialog.showMessageBox({
      type: 'warning',
      title: msg('quitTitle'),
      message: msg('quitFailed'),
      buttons: [msg('quitStay')],
      icon: appIcon
    })
    return false
  } finally {
    // leaving 分支保持冻结直到进程退出；外层退出流程若折返留下，由 cancelRecordingQuit 恢复
    if (!leaving) cancelRecordingQuit(manager)
  }
}

/** 退出流程中断/折返后恢复录制常态：解冻新 start、恢复结果通知（幂等，可安全重入） */
export const cancelRecordingQuit = (manager: RecordingManager): void => {
  const notifications = notificationServices.get(manager)
  notifications?.pause(false)
  manager.setFrozen(false)
}
