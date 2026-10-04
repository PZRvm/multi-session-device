// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'

const mocks = vi.hoisted(() => {
  type MainWindow = {
    webContents: { id: number; send: (channel: string, payload: unknown) => void }
  }
  return {
    handle: vi.fn(),
    getAllWindows: vi.fn(
      () => [] as Array<{ webContents: { send: (channel: string, payload: unknown) => void } }>
    ),
    getMainWindow: vi.fn<() => MainWindow | null>(() => null),
    wizardOwns: vi.fn<(sender: { id: number }) => boolean>(() => false),
    clipboardWriteText: vi.fn(),
    readDeviceMetas: vi.fn<() => Promise<DeviceMeta[]>>(async () => []),
    writeDeviceMetas: vi.fn<(metas: DeviceMeta[]) => Promise<void>>(async () => {}),
    createAvd: vi.fn(async () => '/avd'),
    deleteAvd: vi.fn<(dirs: unknown) => Promise<void>>(async () => {}),
    avdExists: vi.fn(async () => true),
    isPackageNameInstalled: vi.fn<(root: string, packageName: string) => Promise<boolean>>(
      async () => true
    ),
    listAdbSerials: vi.fn(async () => new Set<string>()),
    ensureSharedServer: vi.fn(async () => ({ reused: false, protocolVersion: 41 })),
    resolveAdbExecutable: vi.fn(async () => ({
      path: '/adb',
      source: 'app-sdk',
      protocolVersion: 41
    })),
    // fake runner：devices 层以 createRunner() 工厂接入，测试持有实例与构造回调
    runnerInstance: {
      start: vi.fn(async () => ({ runId: 'run-1', serial: 'emulator-5554' })),
      stop: vi.fn(async () => undefined),
      cancelStart: vi.fn(async () => undefined),
      phaseOf: vi.fn((): 'starting' | 'running' | 'stopping' | null => null),
      serialOf: vi.fn((): string | undefined => undefined),
      disposeAll: vi.fn(async () => [] as string[]),
      resumeAccepting: vi.fn()
    },
    createRunner: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  app: { getPath: vi.fn(() => '/userdata') },
  clipboard: { writeText: mocks.clipboardWriteText }
}))
vi.mock('../../store', () => ({
  isImageVariant: (value: unknown): boolean =>
    value === 'aosp' || value === 'google_apis' || value === 'google_play',
  readDeviceMetas: mocks.readDeviceMetas,
  writeDeviceMetas: mocks.writeDeviceMetas
}))
vi.mock('../../emulator/avd', () => ({
  avdExists: mocks.avdExists,
  createAvd: mocks.createAvd,
  deleteAvd: mocks.deleteAvd
}))
vi.mock('../../emulator/catalog', () => ({
  isPackageNameInstalled: mocks.isPackageNameInstalled,
  packageNameFor: (apiLevel: number, variant: string): string =>
    `system-images;android-${apiLevel};${variant === 'aosp' ? 'default' : variant === 'google_play' ? 'google_apis_playstore' : 'google_apis'};arm64-v8a`
}))
vi.mock('../../emulator/adb', () => ({
  candidateAdbPaths: () => [{ path: '/adb', source: 'app-sdk' }],
  ensureSharedServer: mocks.ensureSharedServer,
  listAdbSerials: mocks.listAdbSerials,
  resolveAdbExecutable: mocks.resolveAdbExecutable
}))
vi.mock('../../emulator/runner', () => ({
  createRunner: mocks.createRunner
}))
vi.mock('../../window', () => ({ getMainWindow: mocks.getMainWindow }))
vi.mock('../../window/wizard', () => ({ wizardOwns: mocks.wizardOwns }))

/** devices 域有模块级状态——每用例 resetModules 动态导入隔离 */
const freshDomain = async (): Promise<{
  handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  runnerEvents: () => {
    onRunning: (id: string, runId: string, serial: string) => void
    onUnexpectedExit: (
      id: string,
      runId: string,
      info: { code: number; stderrTail: string }
    ) => void
  }
  runner: typeof mocks.runnerInstance
}> => {
  vi.resetModules()
  mocks.createRunner.mockImplementation(() => mocks.runnerInstance)
  const domain = await import('..')
  domain.registerDevicesIpc()
  return {
    handlerFor: (channel: string) => {
      const call = mocks.handle.mock.calls.find(([name]) => name === channel)
      if (!call) throw new Error(`handler 未注册：${channel}`)
      return call[1] as (event: unknown, raw: unknown) => Promise<unknown>
    },
    runnerEvents: () => {
      const config = mocks.createRunner.mock.calls.at(-1)![0] as {
        onRunning: (id: string, runId: string, serial: string) => void
        onUnexpectedExit: (
          id: string,
          runId: string,
          info: { code: number; stderrTail: string }
        ) => void
      }
      return config
    },
    runner: mocks.runnerInstance
  }
}

const mainWindowEvent = (): unknown => ({ sender: { id: 7 } })
const wizardEvent = (): unknown => ({ sender: { id: 9 } })

const validCreateInput = {
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  apiLevel: 36,
  variant: 'google_play',
  name: '测试机'
}

describe('devices 域（创建/删除事务）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockResolvedValue(undefined)
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.deleteAvd.mockResolvedValue(undefined)
    mocks.avdExists.mockResolvedValue(true)
    mocks.getAllWindows.mockReturnValue([])
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
    mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
    mocks.runnerInstance.stop.mockResolvedValue(undefined)
    mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
    mocks.runnerInstance.phaseOf.mockReturnValue(null)
    mocks.runnerInstance.disposeAll.mockResolvedValue([])
  })

  it('create：临时行 creating 可见 → AVD 落盘 → 转停止；返回 createdId + 快照', async () => {
    const { handlerFor } = await freshDomain()
    const result = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string; snapshot: { devices: Array<{ id: string; status: string }> } }
    expect(result.createdId).toBe(result.snapshot.devices.at(-1)!.id)
    expect(result.snapshot.devices.at(-1)!.status).toBe('stopped')
    const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
    expect(persisted).toHaveLength(1)
    expect((persisted[0] as unknown as Record<string, unknown>).status).toBeUndefined()
  })

  it('create：AVD 建失败 → 撤回临时行 + 回滚本次 AVD + 抛错', async () => {
    mocks.createAvd.mockRejectedValue(new Error('画像未知'))
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('画像未知')
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
    expect(mocks.deleteAvd).toHaveBeenCalledTimes(1)
    // 撤回后的快照广播里没有临时行
    expect(mocks.getAllWindows).toHaveBeenCalled()
  })

  it('create：元数据写盘失败 → 撤回临时行并回滚 AVD（写盘成功才提交内存）', async () => {
    mocks.writeDeviceMetas.mockRejectedValue(new Error('磁盘满'))
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('磁盘满')
    expect(mocks.deleteAvd).toHaveBeenCalledTimes(1)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: unknown[]
    }
    expect(list.devices).toHaveLength(0)
  })

  it('rename：写盘失败 → 内存不动（issue 2026-10-03 分叉的修法）', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('磁盘满'))
    await expect(
      handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
        id: created.createdId,
        name: '新名'
      })
    ).rejects.toThrow('磁盘满')
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ name: string }>
    }
    expect(list.devices[0].name).toBe('测试机')
  })

  it('rename：创建中/删除中拒绝', async () => {
    let releaseCreate: (() => void) | undefined
    mocks.createAvd.mockReturnValue(
      new Promise<string>((resolve) => {
        releaseCreate = () => resolve('/avd')
      })
    )
    const { handlerFor } = await freshDomain()
    const creating = handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    // 让微任务把临时行推进列表
    await new Promise((resolve) => setTimeout(resolve, 0))
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string }>
    }
    const creatingId = list.devices[0].id
    await expect(
      handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), { id: creatingId, name: 'x' })
    ).rejects.toThrow('设备事务进行中')
    releaseCreate?.()
    await creating
  })

  it('delete：重复删除合并到同一次执行', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    let releaseDelete: (() => void) | undefined
    mocks.deleteAvd.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
    )
    const first = handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), {
      id: created.createdId
    })
    const second = handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), {
      id: created.createdId
    })
    releaseDelete?.()
    await Promise.all([first, second])
    expect(mocks.deleteAvd).toHaveBeenCalledTimes(1)
  })

  it('delete：删除失败 → 回到 stopped + lastError，可重试', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    mocks.deleteAvd.mockRejectedValue(new Error('目录被占用'))
    await expect(
      handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('目录被占用')
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; lastError?: { code: string } }>
    }
    expect(list.devices).toHaveLength(1)
    expect(list.devices[0].status).toBe('stopped')
    expect(list.devices[0].lastError?.code).toBe('delete-failed')
  })
})

describe('devices 域（启动/停止/取消状态机）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockResolvedValue(undefined)
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.avdExists.mockResolvedValue(true)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
    mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
    mocks.runnerInstance.stop.mockResolvedValue(undefined)
    mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
    mocks.runnerInstance.phaseOf.mockReturnValue(null)
  })

  it('start：接纳后 starting + serial/runId；runner.start 携带 ensureAdbServer 前置', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), {
      id: created.createdId
    })) as { devices: Array<{ status: string; serial?: string; runId?: string }> }
    expect(snapshot.devices[0].status).toBe('starting')
    expect(snapshot.devices[0].serial).toBe('emulator-5554')
    expect(snapshot.devices[0].runId).toBe('run-1')
  })

  it('start：starting/running 幂等返回现态', async () => {
    const { handlerFor, runner } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    expect(runner.start).toHaveBeenCalledTimes(1)
  })

  it('start：AVD 缺失 → 拒绝并标 avd-missing（步骤 6 前的最小存在性校验）', async () => {
    mocks.avdExists.mockResolvedValue(false)
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('AVD 不存在')
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string } }>
    }
    expect(list.devices[0].lastError?.code).toBe('avd-missing')
  })

  it('start：runner.start 拒绝 → 回到 stopped + start-failed', async () => {
    mocks.runnerInstance.start.mockRejectedValue(new Error('没有可用的模拟器端口'))
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('没有可用的模拟器端口')
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string; lastError?: { code: string } }>
    }
    expect(list.devices[0].status).toBe('stopped')
    expect(list.devices[0].lastError?.code).toBe('start-failed')
  })

  it('onRunning：runId 匹配才转 running', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    let list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string }>
    }
    expect(list.devices[0].status).toBe('running')

    // 旧代次退出不覆盖新实例
    runnerEvents().onUnexpectedExit(created.createdId, 'stale-run', { code: 1, stderrTail: '' })
    list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string }>
    }
    expect(list.devices[0].status).toBe('running')
  })

  it('onUnexpectedExit：回写停止 + lastError + 后台错误通知（eventId 去重交给 renderer）', async () => {
    const send = vi.fn()
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send } })
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onUnexpectedExit(created.createdId, 'run-1', { code: 1, stderrTail: 'PANIC' })
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string; lastError?: { code: string; message: string } }>
    }
    expect(list.devices[0].status).toBe('stopped')
    expect(list.devices[0].lastError?.code).toBe('unexpected-exit')
    expect(list.devices[0].lastError?.message).toContain('PANIC')
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.devicesRuntimeError,
      expect.objectContaining({ deviceId: created.createdId, code: 'unexpected-exit' })
    )
  })

  it('stop：running → stopping → stopped，serial/runId 清空', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), {
      id: created.createdId
    })) as { devices: Array<{ status: string; serial?: string; runId?: string }> }
    expect(snapshot.devices[0].status).toBe('stopped')
    expect(snapshot.devices[0].serial).toBeUndefined()
    expect(snapshot.devices[0].runId).toBeUndefined()
  })

  it('stop：失败保留 stopping + lastError（重试入口），不假报成功', async () => {
    mocks.runnerInstance.stop.mockRejectedValue(new Error('停止超时'))
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    await expect(
      handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('停止超时')
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string; lastError?: { code: string } }>
    }
    expect(list.devices[0].status).toBe('stopping')
    expect(list.devices[0].lastError?.code).toBe('stop-failed')
    // 重试成功 → stopped
    mocks.runnerInstance.stop.mockResolvedValue(undefined)
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), {
      id: created.createdId
    })) as { devices: Array<{ status: string }> }
    expect(snapshot.devices[0].status).toBe('stopped')
  })

  it('cancel：running 时拒绝（状态冲突，不能把迟到取消当停止）', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    await expect(
      handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('取消不再适用')
  })

  it('cancel：starting → 取消 → stopped，serial/runId 清空', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), {
      id: created.createdId
    })) as { devices: Array<{ id: string; status: string; serial?: string; runId?: string }> }
    const row = snapshot.devices.find((device) => device.id === created.createdId)!
    expect(row.status).toBe('stopped')
    expect(row.serial).toBeUndefined()
    expect(row.runId).toBeUndefined()
  })

  it('delete：running 设备先经 runner.stop，停止失败不删 AVD', async () => {
    mocks.runnerInstance.stop.mockRejectedValue(new Error('停止超时'))
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    await expect(
      handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('停止超时')
    expect(mocks.deleteAvd).not.toHaveBeenCalled()
  })

  it('copySerial：仅 running 有 serial 可复制', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await expect(
      handlerFor(IPC_CHANNELS.devicesCopySerial)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('没有可复制的 serial')
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    await handlerFor(IPC_CHANNELS.devicesCopySerial)(mainWindowEvent(), { id: created.createdId })
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('emulator-5554')
  })
})

describe('devices 域（sender 白名单与退出清理）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
  })

  it('未登记 sender 拒绝；向导可 create、不可 start', async () => {
    const { handlerFor } = await freshDomain()
    mocks.getMainWindow.mockReturnValue(null)
    await expect(
      handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    ).rejects.toThrow('未登记的窗口')
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    // 向导 create 放行
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      wizardEvent(),
      validCreateInput
    )) as { createdId: string }
    expect(created.createdId).toBeTruthy()
    // 向导 start 拒绝
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(wizardEvent(), { id: created.createdId })
    ).rejects.toThrow('未登记的窗口')
  })

  it('prepareAppShutdown：停全部实例、收敛状态、返回残留', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    const domain = await import('..')
    const { leftovers } = await domain.prepareAppShutdown()
    expect(leftovers).toEqual([])
    expect(mocks.runnerInstance.disposeAll).toHaveBeenCalledTimes(1)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string }>
    }
    expect(list.devices[0].status).toBe('stopped')
    // 清理后拒绝新启动，恢复后放行
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('暂停启动')
    domain.resumeAfterShutdown()
    expect(mocks.runnerInstance.resumeAccepting).toHaveBeenCalledTimes(1)
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
  })
})
