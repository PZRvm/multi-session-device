// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS as C } from '@shared/ipc-channels'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  dialog: vi.fn(),
  manager: {
    ready: vi.fn(async () => undefined),
    snapshot: vi.fn(() => ({ revision: 0, tasks: [], limit: 2 })),
    start: vi.fn(),
    command: vi.fn(),
    hasPending: vi.fn(() => true),
    setFrozen: vi.fn(),
    saveForQuit: vi.fn(async () => true),
    discardForQuit: vi.fn(async () => undefined)
  }
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/msd-test', once: vi.fn() },
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(name, fn)
  },
  dialog: { showMessageBox: mocks.dialog },
  shell: { showItemInFolder: vi.fn() }
}))
vi.mock('../preferences', () => ({
  RecordingPreferences: class {
    reset = vi.fn(async () => undefined)
  }
}))
vi.mock('../../app-icon', () => ({ appIcon: {} }))
vi.mock('../manager', () => ({
  RecordingManager: class {
    constructor() {
      return mocks.manager
    }
  }
}))
import { confirmRecordingQuit, registerRecording } from '../index'
import type { RecordingManager } from '../manager'
const main = { mainFrame: {} }
const settings = { mainFrame: {} }
const event = { sender: main, senderFrame: main.mainFrame }
const invoke = (channel: string, raw?: unknown, sender = event): Promise<unknown> =>
  mocks.handlers.get(channel)!(sender, raw)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.manager.hasPending.mockReturnValue(true)
  mocks.manager.saveForQuit.mockResolvedValue(true)
  registerRecording({
    adbPath: () => '/adb',
    toolEnv: () => ({}),
    scrcpy: {} as never,
    device: vi.fn(),
    isMainSender: (sender) => sender === main,
    pushTarget: () => null,
    isSettingsSender: (sender) => sender === settings
  })
})
describe('recording commands and quit boundary', () => {
  it('only lets the registered settings main frame reset prompts', async () => {
    await expect(invoke(C.recordingResetPrompts)).rejects.toThrow('Unauthorized')
    await expect(
      invoke(C.recordingResetPrompts, undefined, { sender: settings, senderFrame: {} })
    ).rejects.toThrow('Unauthorized')
    await expect(
      invoke(C.recordingResetPrompts, undefined, {
        sender: settings,
        senderFrame: settings.mainFrame
      })
    ).resolves.toBeUndefined()
  })
  it('rejects foreign senders, subframes, malformed IDs and unknown commands', async () => {
    await expect(
      invoke(C.recordingStart, { deviceId: 'd' }, { sender: { mainFrame: {} }, senderFrame: {} })
    ).rejects.toThrow('Unauthorized')
    await expect(
      invoke(C.recordingStart, { deviceId: 'd' }, { ...event, senderFrame: {} })
    ).rejects.toThrow('Unauthorized')
    for (const raw of [undefined, {}, { deviceId: 1 }, { deviceId: 'x'.repeat(257) }])
      await expect(invoke(C.recordingStart, raw)).rejects.toThrow()
    await expect(
      invoke(C.recordingCommand, { taskId: 'id', command: 'open-arbitrary-file' })
    ).rejects.toThrow()
    expect(mocks.manager.start).not.toHaveBeenCalled()
    expect(mocks.manager.command).not.toHaveBeenCalled()
  })
  it('stays without stopping media and releases the start freeze', async () => {
    mocks.dialog.mockResolvedValue({ response: 1 })
    expect(await confirmRecordingQuit(mocks.manager as unknown as RecordingManager)).toBe(false)
    expect(mocks.manager.saveForQuit).not.toHaveBeenCalled()
    expect(mocks.manager.discardForQuit).not.toHaveBeenCalled()
    expect(mocks.manager.setFrozen.mock.calls).toEqual([[true], [false]])
  })
  it('saves before approving quit and remains in the app if generation fails', async () => {
    mocks.dialog.mockResolvedValue({ response: 0 })
    mocks.manager.saveForQuit.mockResolvedValue(false)
    expect(await confirmRecordingQuit(mocks.manager as unknown as RecordingManager)).toBe(false)
    expect(mocks.dialog).toHaveBeenCalledTimes(2)
    expect(mocks.manager.discardForQuit).not.toHaveBeenCalled()
  })
  it('only discards on the explicit discard choice', async () => {
    mocks.dialog.mockResolvedValue({ response: 2 })
    expect(await confirmRecordingQuit(mocks.manager as unknown as RecordingManager)).toBe(true)
    expect(mocks.manager.discardForQuit).toHaveBeenCalledOnce()
    expect(mocks.manager.saveForQuit).not.toHaveBeenCalled()
  })
})
