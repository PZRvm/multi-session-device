// Quick Boot 快照路径 + 启停/取消状态机（源码 lifecycle.ts + startup.ts runner 装配）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'
import {
  freshDomain,
  mainWindowEvent,
  mocks,
  startThroughPreflight,
  validCreateInput,
  quickDevice
} from './harness'

describe('Quick Boot 运行路径（plan 设计 8；门槛未过保持禁用）', () => {
  // 单文件时代依赖首块 beforeEach 的实现泄漏（clearAllMocks 不清实现）——
  // 拆分后本文件不再有首块，补同等种子（devicesList 的 'create' sender 校验需要主窗）
  beforeEach(() => {
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
  })

  const extraArgsFromConfig = (): ((id: string) => string[]) => {
    const config = mocks.createRunner.mock.calls.at(-1)![0] as {
      extraArgsFor: (id: string) => string[]
    }
    return config.extraArgsFor
  }

  it('quick 且从未有效快照 → -no-snapshot-load（首启冷路径，仍可保存）', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice() as never])
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    const extra = extraArgsFromConfig()
    expect(extra('quick-1')).toContain('-no-snapshot-load')
    expect(extra('quick-1')).not.toContain('-no-snapshot')
  })

  it('quick 且已有有效快照 → 不加载禁止参数（正常恢复路径）', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ snapshotReadyAt: 123 }) as never])
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    const extra = extraArgsFromConfig()
    expect(extra('quick-1')).not.toContain('-no-snapshot-load')
    expect(extra('quick-1')).not.toContain('-no-snapshot')
  })

  it('legacy（无设置）→ 固定 Cold/host，不因新默认改变已有设备行为', async () => {
    mocks.readDeviceMetas.mockResolvedValue([
      quickDevice({ id: 'legacy-1', advancedSettings: null }) as never
    ])
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    expect(extraArgsFromConfig()('legacy-1')).toEqual(['-no-snapshot', '-gpu', 'host'])
  })

  it('cold 设置 → -no-snapshot（与现有行为一致）', async () => {
    const cold = quickDevice()
    ;(cold.advancedSettings as Record<string, unknown>).bootMode = 'cold'
    mocks.readDeviceMetas.mockResolvedValue([cold as never])
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    expect(extraArgsFromConfig()('quick-1')).toContain('-no-snapshot')
  })
})

describe('devices 域（启动/停止/取消状态机）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    // clearAllMocks 不重置实现：上一组用例遗留的 reject 会渗进来，本组自己兜底
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.deleteAvd.mockResolvedValue(undefined)
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

  it('start：准备阶段取消正常回停止，无启动错误或运行字段残留', async () => {
    const { StartCancelledError } = await import('../../emulator/runner')
    let rejectStart: (error: Error) => void = () => {}
    mocks.runnerInstance.start.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStart = reject
        })
    )
    mocks.runnerInstance.cancelStart.mockImplementationOnce(async () => {
      rejectStart(new StartCancelledError())
    })
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    const start = handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), {
      id: created.createdId
    })
    await vi.waitFor(() => expect(mocks.runnerInstance.start).toHaveBeenCalledTimes(1))
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), {
      id: created.createdId
    })) as {
      devices: Array<{
        status: string
        runId?: string
        serial?: string
        startedAt?: number
        lastError?: unknown
      }>
    }
    await expect(start).resolves.toMatchObject({
      devices: [expect.objectContaining({ status: 'stopping', lastError: undefined })]
    })
    expect(snapshot.devices[0]).toMatchObject({ status: 'stopped' })
    expect(snapshot.devices[0].runId).toBeUndefined()
    expect(snapshot.devices[0].serial).toBeUndefined()
    expect(snapshot.devices[0].startedAt).toBeUndefined()
    expect(snapshot.devices[0].lastError).toBeUndefined()
  })

  it('start：旧准备的迟到结果不污染取消后的新启动', async () => {
    let resolveStart: (result: { runId: string; serial: string }) => void = () => {}
    mocks.runnerInstance.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    const oldStart = handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), {
      id: created.createdId
    })
    await vi.waitFor(() => expect(mocks.runnerInstance.start).toHaveBeenCalledTimes(1))
    await handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), { id: created.createdId })
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    resolveStart({ runId: 'old-run', serial: 'emulator-5556' })
    const snapshot = (await oldStart) as { devices: Array<{ runId?: string; serial?: string }> }
    expect(snapshot.devices[0].runId).toBe('run-1')
    expect(snapshot.devices[0].serial).toBe('emulator-5554')
  })

  it('start：准备完成前的 onRunning 已有代次，可直接进入运行态', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    mocks.runnerInstance.start.mockImplementationOnce(async (id: string, runId: string) => {
      runnerEvents().onRunning(id, runId, 'emulator-5554')
      return { runId, serial: 'emulator-5554' }
    })
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), {
      id: created.createdId
    })) as { devices: Array<{ status: string; serial?: string }> }
    expect(snapshot.devices[0].status).toBe('running')
    expect(snapshot.devices[0].serial).toBe('emulator-5554')
  })

  it('start：AVD 文件核验未通过 → 拒绝并标 avd-missing（对账设计 4 的即时核验）', async () => {
    startThroughPreflight()
    mocks.checkDeviceHealth.mockResolvedValue({
      state: 'missing',
      issues: [
        {
          component: 'avd',
          code: 'ini-missing',
          message: 'AVD 不存在或已被外部删除，无法启动',
          severity: 'error'
        }
      ],
      checkedAt: 42
    })
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('AVD 不存在')
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{
        lastError?: { code: string }
        availability?: { state: string }
      }>
    }
    expect(list.devices[0].lastError?.code).toBe('avd-missing')
    expect(list.devices[0].availability?.state).toBe('missing')
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
    expect(list.devices[0]).not.toHaveProperty('runId', expect.anything())
    expect(list.devices[0]).not.toHaveProperty('startedAt', expect.anything())
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
    runnerEvents().onUnexpectedExit(created.createdId, 'stale-run', {
      code: 1,
      stderrTail: '',
      stdoutTail: ''
    })
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
    runnerEvents().onUnexpectedExit(created.createdId, 'run-1', {
      code: 1,
      stderrTail: 'PANIC',
      stdoutTail: ''
    })
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

  it('delete：running 设备先停后删——stop 先于 deleteAvd，落盘不含该 id', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), {
      id: created.createdId
    })) as { devices: unknown[] }
    expect(mocks.runnerInstance.stop).toHaveBeenCalledTimes(1)
    expect(mocks.deleteAvd).toHaveBeenCalledTimes(1)
    expect(mocks.runnerInstance.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteAvd.mock.invocationCallOrder[0]
    )
    expect(snapshot.devices).toHaveLength(0)
    const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
    expect(persisted).toHaveLength(0)
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
