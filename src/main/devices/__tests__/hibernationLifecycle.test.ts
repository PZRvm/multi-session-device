// @vitest-environment node
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceMeta } from '@shared/types'
import { freshDomain, mainWindowEvent, mocks, quickDevice, validCreateInput } from './harness'

const setManifest = (
  entry: Parameters<typeof mocks.hibernationStore.current.set>[1],
  id: string
): void => {
  mocks.hibernationStore.current.set(id, entry)
}

const manifestOf = (id: string): unknown => mocks.hibernationStore.current.get(id)

/** 走创建 → 启动 → running；start mock 透传 runId（与真实 runner 契约一致） */
const startRunning = async (
  handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>,
  runnerEvents: () => { onRunning: (id: string, runId: string, serial: string) => void }
): Promise<string> => {
  const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
    mainWindowEvent(),
    validCreateInput
  )) as { createdId: string }
  await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
  const attemptId = mocks.runnerInstance.start.mock.calls.at(-1)![1] as string
  runnerEvents().onRunning(created.createdId, attemptId, 'emulator-5554')
  return created.createdId
}

/** 休眠成功后设备处于 hibernated 且清单 stage=hibernated（同域可继续收口） */
const hibernatedDevice = async (): Promise<{
  id: string
  handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  domain: Awaited<ReturnType<typeof freshDomain>>['domain']
}> => {
  const ctx = await freshDomain()
  const id = await startRunning(ctx.handlerFor, ctx.runnerEvents)
  await ctx.handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id })
  return { id, handlerFor: ctx.handlerFor, domain: ctx.domain }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
  mocks.storeHealth.mockImplementation(() => ({ state: 'ok', issues: [] }))
  // clearAllMocks 只清调用记录：per-test 覆写的实现必须在此重新播种
  mocks.runnerInstance.start.mockImplementation(async (_id: string, runId: string) => ({
    runId,
    serial: 'emulator-5554'
  }))
  mocks.runnerInstance.stop.mockResolvedValue(undefined)
  mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
  mocks.runnerInstance.quit.mockResolvedValue(undefined)
  mocks.runnerInstance.disposeAll.mockResolvedValue([])
  mocks.runnerInstance.phaseOf.mockImplementation(() => 'running')
  mocks.runnerInstance.serialOf.mockReturnValue('emulator-5554')
  mocks.runnerInstance.portOf.mockImplementation(() => 5554)
  mocks.readDeviceMetas.mockImplementation(async () => [])
  mocks.emuConsoleExec.mockResolvedValue('')
  mocks.runAdb.mockResolvedValue({ code: 0, stdout: 'boot-id-stable\n', stderr: '' })
  mocks.tcpProbe.mockResolvedValue(false)
  mocks.waitHibernationSnapshotStable.mockResolvedValue(1024)
  mocks.cleanupOldHibernationSnapshots.mockResolvedValue(undefined)
})

describe('休眠域（plan 2026-11-06-emulator-hibernation）', () => {
  it('休眠成功：saving → saved → hibernated 清单推进；quit 被调用；端口复核；状态/serial 清空', async () => {
    const writes: string[] = []
    mocks.hibernationStore.current.clear()
    const writeSpy = vi.spyOn(mocks.hibernationStore.current, 'set')
    const { handlerFor, runnerEvents } = await freshDomain()
    const id = await startRunning(handlerFor, runnerEvents)
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), {
      id
    })) as { devices: Array<{ id: string; status: string; serial?: string; runId?: string }> }
    const row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('hibernated')
    expect(row.serial).toBeUndefined()
    expect(row.runId).toBeUndefined()
    expect(mocks.runnerInstance.quit).toHaveBeenCalledTimes(1)
    expect(mocks.tcpProbe).toHaveBeenCalled()
    expect(mocks.emuConsoleExec).toHaveBeenCalledWith(
      5554,
      expect.stringMatching(/avd snapshot save msd-hib-/),
      expect.any(Number)
    )
    expect(mocks.waitHibernationSnapshotStable).toHaveBeenCalled()
    const manifest = manifestOf(id) as { stage: string; guestBootId: string }
    expect(manifest.stage).toBe('hibernated')
    expect(manifest.guestBootId).toBe('boot-id-stable')
    // 媒体拆除经 beforeKill 桥（attachDeviceStreamBridge 默认未接 → 无会话副作用）
    for (const [key, value] of writeSpy.mock.calls as Array<[string, unknown]>) {
      void key
      writes.push((value as { stage: string }).stage)
    }
    expect(writes).toEqual(['saving', 'saved', 'hibernated'])
  })

  it('保存失败且实例仍活：回 running + lastError，清单清除', async () => {
    mocks.emuConsoleExec.mockRejectedValue(new Error('console timeout'))
    const { handlerFor, runnerEvents } = await freshDomain()
    const id = await startRunning(handlerFor, runnerEvents)
    await expect(
      handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id })
    ).rejects.toThrow('console timeout')
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; lastError?: { code: string } }>
    }
    const row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('running')
    expect(row.lastError?.code).toBe('hibernate-save-failed')
    expect(manifestOf(id)).toBeUndefined()
  })

  it('保存失败且进程丢失：回 stopped + hibernate-aborted，清单清除', async () => {
    mocks.emuConsoleExec.mockRejectedValue(new Error('connection reset'))
    mocks.runnerInstance.phaseOf.mockImplementation(() => null)
    mocks.runnerInstance.portOf.mockImplementation(() => 5554)
    const { handlerFor, runnerEvents } = await freshDomain()
    const id = await startRunning(handlerFor, runnerEvents)
    await expect(
      handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id })
    ).rejects.toThrow('connection reset')
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; lastError?: { code: string } }>
    }
    const row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('stopped')
    expect(row.lastError?.code).toBe('hibernate-aborted')
  })

  it('退出失败：留 hibernating + exit-failed；重试（同入口）成功提交 hibernated', async () => {
    mocks.runnerInstance.quit.mockRejectedValueOnce(new Error('未在限期内退出'))
    const { handlerFor, runnerEvents } = await freshDomain()
    const id = await startRunning(handlerFor, runnerEvents)
    await expect(
      handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id })
    ).rejects.toThrow('未在限期内退出')
    let snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; lastError?: { code: string } }>
    }
    let row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('hibernating')
    expect(row.lastError?.code).toBe('hibernate-exit-failed')
    expect((manifestOf(id) as { stage: string }).stage).toBe('saved')
    // 重试：清单已在 saved，直接重试退出
    await handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id })
    snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string }>
    }
    row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('hibernated')
    expect((manifestOf(id) as { stage: string }).stage).toBe('hibernated')
  })

  it('端口仍被监听：进程已确认退出——提交 hibernated 并附端口异常说明', async () => {
    mocks.tcpProbe.mockResolvedValue(true)
    const { handlerFor, runnerEvents } = await freshDomain()
    const id = await startRunning(handlerFor, runnerEvents)
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), {
      id
    })) as { devices: Array<{ id: string; status: string; lastError?: { code: string } }> }
    const row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('hibernated')
    expect(row.lastError?.code).toBe('hibernate-port-anomaly')
    expect((manifestOf(id) as { stage: string }).stage).toBe('hibernated')
  })

  it('忙态守卫：安装/录屏进行中拒绝休眠', async () => {
    const { handlerFor, runnerEvents, domain } = await freshDomain()
    domain.attachHibernationGate({ installerBusyFor: () => true })
    const id = await startRunning(handlerFor, runnerEvents)
    await expect(
      handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id })
    ).rejects.toThrow('正在安装应用')
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string }>
    }
    expect(snapshot.devices.find((device) => device.id === id)!.status).toBe('running')
  })

  it('能力门控：休眠要求 running；stopped 设备拒绝（伪造 IPC 同样拒绝）', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await expect(
      handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), {
        id: created.createdId
      })
    ).rejects.toThrow('不在运行中')
  })

  it('恢复成功：快照参数 + boot_id 复核通过 → running；清单消费；新 runId', async () => {
    const { id, handlerFor, domain } = await hibernatedDevice()
    // 恢复 argv 经 extraArgsFor：resume plan 生效（-snapshot + -no-snapshot-save，无 -no-snapshot）
    const resume = (await handlerFor(IPC_CHANNELS.devicesResume)(mainWindowEvent(), {
      id
    })) as { devices: Array<{ id: string; status: string; runId?: string }> }
    void resume
    // runner.start 已受理；afterBoot 复核 boot_id（mock runAdb 返回 boot-id-stable = 清单值）
    const runnerConfig = mocks.createRunner.mock.calls.at(-1)![0] as {
      extraArgsFor: (id: string) => string[]
      afterBoot: (id: string, runId: string, serial: string, signal: AbortSignal) => Promise<void>
      onRunning: (id: string, runId: string, serial: string) => void
    }
    expect(runnerConfig.extraArgsFor(id)).toEqual(
      expect.arrayContaining(['-snapshot', expect.stringMatching(/^msd-hib-/), '-no-snapshot-save'])
    )
    expect(runnerConfig.extraArgsFor(id)).not.toContain('-no-snapshot')
    const depsAfterBoot = runnerConfig.afterBoot
    const startCall = mocks.runnerInstance.start.mock.calls.at(-1)!
    const attemptRunId = startCall[1] as string
    await depsAfterBoot(id, attemptRunId, 'emulator-5554', new AbortController().signal)
    runnerConfig.onRunning(id, attemptRunId, 'emulator-5554')
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; runId?: string }>
    }
    const row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('running')
    expect(row.runId).toBe(attemptRunId)
    // 成功后消费清单
    expect(manifestOf(id)).toBeUndefined()
    expect(mocks.cleanupOldHibernationSnapshots).toHaveBeenCalled()
    void domain
  })

  it('恢复复核失败（boot_id 不一致）：回 hibernated + resume-failed，清单保留', async () => {
    const { id, handlerFor } = await hibernatedDevice()
    await handlerFor(IPC_CHANNELS.devicesResume)(mainWindowEvent(), { id })
    const runnerConfig = mocks.createRunner.mock.calls.at(-1)![0] as {
      afterBoot: (id: string, runId: string, serial: string, signal: AbortSignal) => Promise<void>
      onUnexpectedExit: (
        id: string,
        runId: string,
        info: { code: number; stderrTail: string; stdoutTail: string }
      ) => void
    }
    // 快照加载被回退为冷启动：guest boot_id 与清单不一致
    mocks.runAdb.mockResolvedValueOnce({ code: 0, stdout: 'cold-boot-id\n', stderr: '' })
    const startCall = mocks.runnerInstance.start.mock.calls.at(-1)!
    const attemptRunId = startCall[1] as string
    await expect(
      runnerConfig.afterBoot(id, attemptRunId, 'emulator-5554', new AbortController().signal)
    ).rejects.toThrow(/boot_id/)
    runnerConfig.onUnexpectedExit(id, attemptRunId, {
      code: -1,
      stderrTail: 'boot mismatch',
      stdoutTail: ''
    })
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; lastError?: { code: string } }>
    }
    const row = snapshot.devices.find((device) => device.id === id)!
    expect(row.status).toBe('hibernated')
    expect(row.lastError?.code).toBe('resume-failed')
    expect((manifestOf(id) as { stage: string }).stage).toBe('hibernated')
  })

  it('取消恢复：回 hibernated（清单保留），不得 stopped', async () => {
    const { id, handlerFor } = await hibernatedDevice()
    // start 受理即返回（真实契约）；不触发 onRunning → 停留在 resuming
    mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
    await handlerFor(IPC_CHANNELS.devicesResume)(mainWindowEvent(), { id })
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), {
      id
    })) as { devices: Array<{ id: string; status: string }> }
    expect(snapshot.devices.find((device) => device.id === id)!.status).toBe('hibernated')
    expect((manifestOf(id) as { stage: string }).stage).toBe('hibernated')
  })

  it('放弃休眠：清单与快照清理 → stopped', async () => {
    const { id, handlerFor } = await hibernatedDevice()
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesDiscardHibernation)(mainWindowEvent(), {
      id
    })) as { devices: Array<{ id: string; status: string }> }
    expect(snapshot.devices.find((device) => device.id === id)!.status).toBe('stopped')
    expect(manifestOf(id)).toBeUndefined()
    expect(mocks.cleanupOldHibernationSnapshots).toHaveBeenCalled()
  })

  it('放弃前状态守卫：非 hibernated 拒绝', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await expect(
      handlerFor(IPC_CHANNELS.devicesDiscardHibernation)(mainWindowEvent(), {
        id: created.createdId
      })
    ).rejects.toThrow('不在休眠状态')
  })

  it('启动扫描投影：hibernated 清单 → hibernated；saving 中断 → stopped + 原因 + 清单清除', async () => {
    const meta = quickDevice() as unknown as DeviceMeta
    const manifestBase = {
      schemaVersion: 1 as const,
      deviceId: meta.id,
      snapshotName: 'msd-hib-proj1',
      savedAt: 1,
      guestBootId: 'boot-id-stable',
      stage: 'hibernated' as const,
      emulatorVersion: '36.1.9',
      imagePackageName: meta.imagePackageName,
      imageRevision: null,
      gpuBackend: 'host',
      hardwareFingerprint: 'any'
    }
    // 第一域：hibernated 清单 → 投影 hibernated（种子在 freshDomain 之后——它会清空内存态）
    const d1ctx = await freshDomain()
    mocks.readDeviceMetas.mockResolvedValue([meta])
    setManifest(manifestBase, meta.id)
    const first = (await d1ctx.handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as { devices: Array<{ id: string; status: string }> }
    expect(first.devices.find((device) => device.id === meta.id)!.status).toBe('hibernated')

    // 第二域：saving 中断（保存未完成）→ stopped + hibernation-interrupted，清单清除
    const d2ctx = await freshDomain()
    mocks.readDeviceMetas.mockResolvedValue([meta])
    setManifest({ ...manifestBase, stage: 'saving' }, meta.id)
    const second = (await d2ctx.handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as {
      devices: Array<{ id: string; status: string; lastError?: { code: string } }>
    }
    const row = second.devices.find((device) => device.id === meta.id)!
    expect(row.status).toBe('stopped')
    expect(row.lastError?.code).toBe('hibernation-interrupted')
    expect(manifestOf(meta.id)).toBeUndefined()
  })

  it('应用退出映射：resuming → hibernated；hibernating（退出失败静止）→ stopped', async () => {
    // resuming（start 已受理、onRunning 未触发）→ 退出收口回 hibernated（清单保留）
    const hib = await hibernatedDevice()
    await hib.handlerFor(IPC_CHANNELS.devicesResume)(mainWindowEvent(), { id: hib.id })
    await hib.domain.prepareAppShutdown()
    const after = (await hib.handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as { devices: Array<{ id: string; status: string }> }
    expect(after.devices.find((device) => device.id === hib.id)!.status).toBe('hibernated')
    expect((manifestOf(hib.id) as { stage: string }).stage).toBe('hibernated')

    // hibernating（退出失败后的静止态）→ 退出收口回 stopped
    mocks.runnerInstance.quit.mockRejectedValue(new Error('exit stuck'))
    const d2ctx = await freshDomain()
    const id2 = await startRunning(d2ctx.handlerFor, d2ctx.runnerEvents)
    await expect(
      d2ctx.handlerFor(IPC_CHANNELS.devicesHibernate)(mainWindowEvent(), { id: id2 })
    ).rejects.toThrow('exit stuck')
    await d2ctx.domain.prepareAppShutdown()
    const after2 = (await d2ctx.handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as { devices: Array<{ id: string; status: string }> }
    expect(after2.devices.find((device) => device.id === id2)!.status).toBe('stopped')
  })
})
