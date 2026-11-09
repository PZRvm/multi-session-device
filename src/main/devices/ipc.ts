import { clipboard, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type {
  CreateDeviceResult,
  DeviceEditSnapshot,
  DeviceSnapshot,
  ReconcileReport,
  ReconcileResult
} from '@shared/types'
import { msg } from '../locale'
import { getMainWindow } from '../window'
import { getReportWindow } from '../window/report'
import { wizardContextOf } from '../window/wizard'
import {
  isCreateDeviceInput,
  isDeviceIdInput,
  isRenameInput,
  isReorderInput,
  isUpdateDeviceInput,
  normalizeName
} from './environment'
import { acknowledgeReconciliation, ensureLoaded, reconcileDevices } from './scan'
import { lastReportNow, requireDevice, snapshotNow } from './state'
import { assertSdkDomainOpen } from './startup'
import {
  cancelStartDevice,
  deleteDevice,
  discardHibernationDevice,
  hibernateDevice,
  resumeDevice,
  startDevice,
  stopDevice
} from './lifecycle'
import { createDevice, renameDevice } from './create'
import { readDeviceConfig, updateDeviceConfig } from './edit'
import { reorderDevices } from './reorder'

// ---- sender 白名单：启停/删除/复制/对账仅登记主窗；创建允许主窗与 create 向导；
// 配置读写仅绑定目标设备的编辑窗（主窗不直接写附加配置）----

type IpcEvent = Electron.IpcMainInvokeEvent

const requireSender = (
  channel: string,
  event: IpcEvent,
  scope: 'main' | 'create' | { edit: string }
): void => {
  const isMain = getMainWindow()?.webContents.id === event.sender.id
  if (scope === 'main') {
    if (!isMain) throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
    return
  }
  if (scope === 'create') {
    // create 上下文窗口（或主窗）；编辑窗不能发起创建——create/edit 隔离
    if (isMain || wizardContextOf(event.sender)?.kind === 'create') return
    throw new Error(`${channel}: ${msg('unregisteredWindowSuffix')}`)
  }
  const context = wizardContextOf(event.sender)
  if (context?.kind === 'edit' && context.deviceId === scope.edit) return
  throw new Error(`${channel}: ${msg('configWindowNotAllowedSuffix')}`)
}

export function registerDevicesIpc(): void {
  ipcMain.handle(IPC_CHANNELS.devicesList, async (_event): Promise<DeviceSnapshot> => {
    requireSender(IPC_CHANNELS.devicesList, _event, 'create')
    await ensureLoaded()
    return snapshotNow()
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesCreate,
    async (event, raw: unknown): Promise<CreateDeviceResult> => {
      requireSender(IPC_CHANNELS.devicesCreate, event, 'create')
      if (!isCreateDeviceInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesCreate}${msg('invalidPayload')}`)
      }
      assertSdkDomainOpen()
      return createDevice(raw)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesRename,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesRename, event, 'main')
      if (!isRenameInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesRename}${msg('invalidPayload')}`)
      }
      const name = normalizeName(raw.name)
      if (!name) throw new Error(`${IPC_CHANNELS.devicesRename}${msg('invalidName')}`)
      return renameDevice(raw.id, name)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesDelete,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesDelete, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesDelete}${msg('invalidPayload')}`)
      }
      return deleteDevice(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesReorder,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesReorder, event, 'main')
      if (!isReorderInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesReorder}${msg('invalidPayload')}`)
      }
      return reorderDevices(raw.ids)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesStart,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesStart, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesStart}${msg('invalidPayload')}`)
      }
      assertSdkDomainOpen()
      return startDevice(raw.id)
    }
  )

  ipcMain.handle(IPC_CHANNELS.devicesStop, async (event, raw: unknown): Promise<DeviceSnapshot> => {
    requireSender(IPC_CHANNELS.devicesStop, event, 'main')
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesStop}${msg('invalidPayload')}`)
    }
    return stopDevice(raw.id)
  })

  // ---- 休眠域（plan 2026-11-06-emulator-hibernation；仅登记主窗）----

  ipcMain.handle(
    IPC_CHANNELS.devicesHibernate,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesHibernate, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesHibernate}${msg('invalidPayload')}`)
      }
      assertSdkDomainOpen()
      return hibernateDevice(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesResume,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesResume, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesResume}${msg('invalidPayload')}`)
      }
      assertSdkDomainOpen()
      return resumeDevice(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesDiscardHibernation,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesDiscardHibernation, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesDiscardHibernation}${msg('invalidPayload')}`)
      }
      return discardHibernationDevice(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesCancelStart,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      requireSender(IPC_CHANNELS.devicesCancelStart, event, 'main')
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesCancelStart}${msg('invalidPayload')}`)
      }
      return cancelStartDevice(raw.id)
    }
  )

  // ---- 配置编辑域（plan 2026-10-08-device-config-edit）----

  ipcMain.handle(
    IPC_CHANNELS.devicesReadConfig,
    async (event, raw: unknown): Promise<DeviceEditSnapshot> => {
      if (!isDeviceIdInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesReadConfig}${msg('invalidPayload')}`)
      }
      requireSender(IPC_CHANNELS.devicesReadConfig, event, { edit: raw.id })
      return readDeviceConfig(raw.id)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesUpdateConfig,
    async (event, raw: unknown): Promise<DeviceSnapshot> => {
      if (!isUpdateDeviceInput(raw)) {
        throw new Error(`${IPC_CHANNELS.devicesUpdateConfig}${msg('invalidPayload')}`)
      }
      requireSender(IPC_CHANNELS.devicesUpdateConfig, event, { edit: raw.id })
      return updateDeviceConfig(raw)
    }
  )

  ipcMain.handle(IPC_CHANNELS.devicesCopySerial, async (event, raw: unknown): Promise<void> => {
    requireSender(IPC_CHANNELS.devicesCopySerial, event, 'main')
    if (!isDeviceIdInput(raw)) {
      throw new Error(`${IPC_CHANNELS.devicesCopySerial}${msg('invalidPayload')}`)
    }
    const device = requireDevice(raw.id)
    if (device.status !== 'running' || !device.serial) {
      throw new Error(msg('copySerialNotRunning'))
    }
    clipboard.writeText(device.serial)
  })

  ipcMain.handle(IPC_CHANNELS.devicesReconcile, async (event): Promise<ReconcileResult> => {
    requireSender(IPC_CHANNELS.devicesReconcile, event, 'main')
    return reconcileDevices()
  })

  ipcMain.handle(
    IPC_CHANNELS.devicesReconciliationReport,
    async (event): Promise<ReconcileReport | null> => {
      // 对账详情窗（子窗口方案）也允许拉完整报告——sender 由 report 窗口域单例管理
      const isReport = getReportWindow()?.webContents.id === event.sender.id
      if (!isReport) {
        requireSender(IPC_CHANNELS.devicesReconciliationReport, event, 'main')
      }
      // 只回最近报告：不 ensureLoaded、不触发隐式扫描（plan 设计 5）
      return lastReportNow()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.devicesReconciliationAck,
    async (event, raw: unknown): Promise<void> => {
      requireSender(IPC_CHANNELS.devicesReconciliationAck, event, 'main')
      if (
        typeof raw !== 'object' ||
        raw === null ||
        typeof (raw as { signature?: unknown }).signature !== 'string'
      ) {
        throw new Error(`${IPC_CHANNELS.devicesReconciliationAck}${msg('invalidPayload')}`)
      }
      acknowledgeReconciliation((raw as { signature: string }).signature)
    }
  )
}
