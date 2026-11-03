// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { ExternalSessionEvent } from '../../devices/external'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw?: unknown) => Promise<unknown>>(),
  external: undefined as ((event: ExternalSessionEvent) => void) | undefined,
  bindings: new Map<number, { deviceId: string; sessionId: string }>(),
  downloads: '',
  beforeLink: undefined as (() => void) | undefined,
  main: { webContents: { id: 1 } },
  png: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('image')])
}))
vi.mock('electron', () => ({
  app: { getPath: () => state.downloads },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw?: unknown) => Promise<unknown>) =>
      state.handlers.set(channel, handler)
  },
  clipboard: { writeImage: vi.fn() },
  nativeImage: {
    createFromBuffer: () => ({ getSize: () => ({ width: 100, height: 200 }), isEmpty: () => false })
  }
}))
vi.mock('../../devices', () => ({
  registerDevicesIpc: vi.fn(),
  attachDeviceStreamBridge: vi.fn(),
  registerExternalIpc: (deps: { onSession: (event: ExternalSessionEvent) => void }) => {
    state.external = deps.onSession
  },
  adbBinaryPath: () => '/fake/adb',
  androidToolEnv: vi.fn(),
  deviceRefOfId: async () => ({ serial: 'usb-test', name: '真机' }),
  isDeviceActiveOfId: () => true,
  assertEditorTarget: vi.fn(),
  appOwnedDeviceCount: vi.fn(),
  externalRuntimeViews: () => [],
  listDeviceNamesReferencing: vi.fn(),
  listDeviceRuntimeViews: () => [],
  purgeAppOwnedDevices: vi.fn(),
  savedDeviceSkinRef: vi.fn(),
  serialOfDeviceId: vi.fn(),
  triggerSourceChangeReconcile: vi.fn()
}))
vi.mock('../../window', () => ({ getMainWindow: () => state.main }))
vi.mock('../../window/screenshotEditor', () => ({
  openScreenshotEditorWindow: async (sessionId: string, deviceId: string) => {
    if (![...state.bindings.values()].some((binding) => binding.sessionId === sessionId))
      state.bindings.set(10 + state.bindings.size, { sessionId, deviceId })
  },
  screenshotEditorSession: (sender: { id: number }) => state.bindings.get(sender.id) ?? null
}))
vi.mock('../../window/settings', () => ({ settingsOwns: vi.fn(), registerSettingsIpc: vi.fn() }))
vi.mock('../../window/wizard', () => ({ registerWizardIpc: vi.fn() }))
vi.mock('../../window/wireless', () => ({ wirelessOwns: vi.fn(), registerWirelessIpc: vi.fn() }))
vi.mock('../../window/logcat', () => ({
  registerLogcatIpc: vi.fn(),
  isLogcatWindowSender: vi.fn()
}))
vi.mock('../../window/report', () => ({ registerReportIpc: vi.fn() }))
vi.mock('../../dialog', () => ({ registerDialogIpc: vi.fn() }))
vi.mock('../../apkInstall', () => ({ registerApkInstallIpc: vi.fn() }))
vi.mock('../../emulator', () => ({ registerSdkIpc: vi.fn(), onSdkSourceChanged: vi.fn() }))
vi.mock('../../network', () => ({
  registerNetworkIpc: () => ({ startWatch: vi.fn(), clearWatch: vi.fn() })
}))
vi.mock('../../theme', () => ({ registerThemeIpc: vi.fn() }))
vi.mock('../../locale', () => ({ registerLocaleIpc: vi.fn(), msg: (key: string) => key }))
vi.mock('../../recording', () => ({
  registerRecording: () => ({ stopDevice: vi.fn() }),
  confirmRecordingQuit: vi.fn(),
  cancelRecordingQuit: vi.fn()
}))
vi.mock('../../scrcpy', () => ({
  createScrcpyManager: () => ({
    registerIpc: vi.fn(),
    ensureSession: async () => undefined,
    destroySession: async () => undefined,
    destroyAll: async () => undefined
  })
}))
vi.mock('../../logcat', () => ({
  createLogcatManager: () => ({
    registerIpc: vi.fn(),
    ensureSession: vi.fn(),
    destroySession: vi.fn(),
    destroyAll: async () => undefined
  })
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>): Promise<void> => {
      state.beforeLink?.()
      await actual.link(...args)
    }
  }
})
vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: () => void
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn()
    queueMicrotask(() => {
      child.stdout.emit('data', state.png)
      child.emit('close', 0)
    })
    return child
  }
}))
import { registerIpcHandlers } from '../index'
import { clearScreenshotCache } from '../../screenshot'
const invoke = (channel: string, senderId: number, raw?: unknown): Promise<unknown> =>
  state.handlers.get(channel)!({ sender: { id: senderId } }, raw)
beforeEach(async () => {
  state.downloads = await mkdtemp(join(tmpdir(), 'msd-ipc-shot-'))
  state.beforeLink = undefined
  clearScreenshotCache('usb-test')
  clearScreenshotCache('other-device')
  state.handlers.clear()
  state.bindings.clear()
  registerIpcHandlers()
})
afterEach(async () => {
  clearScreenshotCache('usb-test')
  clearScreenshotCache('other-device')
  await rm(state.downloads, { recursive: true, force: true })
})
it('removed 事件使全部旧窗和最近图失效，重连新会话及其他设备保持隔离', async () => {
  for (let i = 0; i < 2; i++) {
    await invoke(IPC_CHANNELS.screenshotCapture, 1, { id: 'usb-test' })
    await invoke(IPC_CHANNELS.screenshotOpenEditor, 1, { id: 'usb-test' })
  }
  await invoke(IPC_CHANNELS.screenshotCapture, 1, { id: 'other-device' })
  await invoke(IPC_CHANNELS.screenshotOpenEditor, 1, { id: 'other-device' })
  const old = (await invoke(IPC_CHANNELS.screenshotGetEditImage, 10)) as { captureId: string }
  state.external!({ kind: 'removed', id: 'usb-test' })
  await expect(invoke(IPC_CHANNELS.screenshotSave, 1, { id: 'usb-test' })).rejects.toThrow(
    'screenshotStale'
  )
  for (const senderId of [10, 11]) {
    await expect(invoke(IPC_CHANNELS.screenshotGetEditImage, senderId)).rejects.toThrow(
      'screenshotStale'
    )
    for (const channel of [IPC_CHANNELS.screenshotEditCopy, IPC_CHANNELS.screenshotEditDownload])
      await expect(
        invoke(channel, senderId, {
          captureId: old.captureId,
          dataUrl: 'data:image/png;base64,' + state.png.toString('base64')
        })
      ).rejects.toThrow('screenshotStale')
  }
  await expect(invoke(IPC_CHANNELS.screenshotGetEditImage, 12)).resolves.toMatchObject({
    width: 100
  })
  state.external!({
    kind: 'connected',
    device: { id: 'usb-test', serial: 'usb-test' } as Extract<
      ExternalSessionEvent,
      { kind: 'connected' }
    >['device'],
    runId: 'ext:usb-test:2'
  })
  await invoke(IPC_CHANNELS.screenshotCapture, 1, { id: 'usb-test' })
  await invoke(IPC_CHANNELS.screenshotOpenEditor, 1, { id: 'usb-test' })
  await expect(invoke(IPC_CHANNELS.screenshotGetEditImage, 13)).resolves.toMatchObject({
    width: 100
  })
  await expect(invoke(IPC_CHANNELS.screenshotGetEditImage, 10)).rejects.toThrow('screenshotStale')
})

it('下载发布期间收到 removed：文件如实成功，旧会话和最近缓存不回填', async () => {
  await invoke(IPC_CHANNELS.screenshotCapture, 1, { id: 'usb-test' })
  await invoke(IPC_CHANNELS.screenshotOpenEditor, 1, { id: 'usb-test' })
  const image = (await invoke(IPC_CHANNELS.screenshotGetEditImage, 10)) as {
    captureId: string
    dataUrl: string
  }
  state.beforeLink = () => state.external!({ kind: 'removed', id: 'usb-test' })
  const result = (await invoke(IPC_CHANNELS.screenshotEditDownload, 10, image)) as {
    fileName: string
  }
  expect(await readFile(join(state.downloads, result.fileName))).toEqual(state.png)
  await expect(invoke(IPC_CHANNELS.screenshotGetEditImage, 10)).rejects.toThrow('screenshotStale')
  await expect(invoke(IPC_CHANNELS.screenshotSave, 1, { id: 'usb-test' })).rejects.toThrow(
    'screenshotStale'
  )
})
