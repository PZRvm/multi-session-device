// 持久化对账：写前 CAS/受控重读/坏库冻结（源码 persistence.ts + scan.ts 首载）
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
  wizardEvent,
  quickDevice
} from './harness'

describe('持久化对账（plan 2026-10-05-avd-reconciliation）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks 不清 mockReturnValue/mockResolvedValue：显式回默认，防上个用例泄漏
    mocks.storeHealth.mockReturnValue({ state: 'ok', issues: [] })
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.deleteAvd.mockResolvedValue(undefined)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
    mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
    mocks.runReconciliation.mockImplementation(
      async (request: { metas: DeviceMeta[] }): Promise<unknown> => ({
        checkedAt: 42,
        availabilityById: new Map(
          request.metas.map((meta) => [meta.id, { state: 'valid', issues: [], checkedAt: 42 }])
        ),
        orphans: [],
        unrecognizedCount: 0,
        scanError: null
      })
    )
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
  })

  it('首载合并健康结果：异常设备带原因、快照携带 storeHealth 与 reconciliation 摘要', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'dead-1' })] as never)
    mocks.runReconciliation.mockResolvedValue({
      checkedAt: 42,
      availabilityById: new Map([
        [
          'dead-1',
          {
            state: 'missing',
            issues: [
              {
                component: 'avd',
                code: 'ini-missing',
                message: '缺少 dead-1.ini',
                severity: 'error'
              }
            ],
            checkedAt: 42
          }
        ]
      ]),
      orphans: [{ id: 'orphan-1', kind: 'orphan', detail: '完整组（无元数据记录）' }],
      unrecognizedCount: 1,
      scanError: null
    })
    const { handlerFor } = await freshDomain()
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ availability?: { state: string; issues: unknown[] } }>
      storeHealth: { state: string }
      reconciliation: Record<string, unknown>
    }
    expect(list.devices[0].availability?.state).toBe('missing')
    expect(list.devices[0].availability?.issues).toHaveLength(1)
    expect(list.storeHealth.state).toBe('ok')
    expect(list.reconciliation).toMatchObject({
      unavailableCount: 1,
      orphanCount: 1,
      storeState: 'ok',
      pendingNotification: true
    })
    expect(typeof list.reconciliation.signature).toBe('string')
  })

  it('store error 首载：空列表 + error 摘要，list 正常落定（可重试）', async () => {
    mocks.storeHealth.mockReturnValue({
      state: 'error',
      issues: [{ code: 'invalid-json', message: 'devices.json 不是合法 JSON' }]
    })
    const { handlerFor } = await freshDomain()
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: unknown[]
      storeHealth: { state: string }
      reconciliation: { storeState: string; pendingNotification: boolean }
    }
    expect(list.devices).toEqual([])
    expect(list.storeHealth.state).toBe('error')
    expect(list.reconciliation.storeState).toBe('error')
    expect(list.reconciliation.pendingNotification).toBe(true)
  })

  it('副作用前守卫：read-only 冻结 create/delete/rename，不动 AVD 不写盘', async () => {
    mocks.storeHealth.mockReturnValue({
      state: 'read-only',
      issues: [
        { code: 'invalid-entry', entryIndex: 0, message: '第 1 条记录字段不合法（name），未载入' }
      ]
    })
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('冻结')
    expect(mocks.createAvd).not.toHaveBeenCalled()
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
    await expect(
      handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: 'd1' })
    ).rejects.toThrow('冻结')
    expect(mocks.deleteAvd).not.toHaveBeenCalled()
    await expect(
      handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), { id: 'd1', name: '新名' })
    ).rejects.toThrow('冻结')
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('人工重查单飞：并发调用共享一轮扫描；返回快照与报告', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    let releaseScan: ((value: unknown) => void) | undefined
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined) // 首载一次扫描
    mocks.runReconciliation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseScan = resolve
        })
    )
    const first = handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    const second = handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    // mock 在微任务里才被调用（releaseScan 才赋值）——等扫描真正挂起再释放
    await vi.waitFor(() => expect(typeof releaseScan).toBe('function'))
    releaseScan?.({
      checkedAt: 99,
      availabilityById: new Map(),
      orphans: [],
      unrecognizedCount: 0,
      scanError: null
    })
    const [a, b] = (await Promise.all([first, second])) as Array<{
      report: { checkedAt: number }
      snapshot: { reconciliation: { pendingNotification: boolean } }
    }>
    expect(mocks.runReconciliation).toHaveBeenCalledTimes(2) // 首载 1 + 重查 1
    expect(a.report.checkedAt).toBe(99)
    expect(b.report.checkedAt).toBe(99)
  })

  it('报告通道：无报告返回 null 且不触发扫描；ack 确认只消费当前签名', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    const { handlerFor } = await freshDomain()
    // 未加载过：报告通道不触发隐式扫描
    expect(
      await handlerFor(IPC_CHANNELS.devicesReconciliationReport)(mainWindowEvent(), undefined)
    ).toBeNull()
    expect(mocks.runReconciliation).not.toHaveBeenCalled()

    const reconcile = (await handlerFor(IPC_CHANNELS.devicesReconcile)(
      mainWindowEvent(),
      undefined
    )) as { report: { signature: string | null; pendingNotification: boolean } }
    expect(reconcile.report.signature).toBeNull() // 全 valid 无异常 → 无签名无提示

    // 制造异常 → 新签名待提示 → ack 消费 → 摘要翻 false
    mocks.runReconciliation.mockResolvedValueOnce({
      checkedAt: 100,
      availabilityById: new Map([
        [
          'd1',
          {
            state: 'broken',
            issues: [
              {
                component: 'avd',
                code: 'ini-path-mismatch',
                message: 'path 不一致',
                severity: 'error'
              }
            ],
            checkedAt: 100
          }
        ]
      ]),
      orphans: [],
      unrecognizedCount: 0,
      scanError: null
    })
    const anomaly = (await handlerFor(IPC_CHANNELS.devicesReconcile)(
      mainWindowEvent(),
      undefined
    )) as { report: { signature: string | null; pendingNotification: boolean } }
    expect(anomaly.report.signature).not.toBeNull()
    expect(anomaly.report.pendingNotification).toBe(true)
    // 迟到的旧签名（null）不消费
    await handlerFor(IPC_CHANNELS.devicesReconciliationAck)(mainWindowEvent(), {
      signature: 'stale-signature'
    })
    let list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      reconciliation: { pendingNotification: boolean }
    }
    expect(list.reconciliation.pendingNotification).toBe(true)
    await handlerFor(IPC_CHANNELS.devicesReconciliationAck)(mainWindowEvent(), {
      signature: anomaly.report.signature
    })
    list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      reconciliation: { pendingNotification: boolean }
    }
    expect(list.reconciliation.pendingNotification).toBe(false)
  })

  it('外部元数据变化：保留内存列表与运行字段、维持冻结并提示重启；恢复一致后解除', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1', name: '本机名' })] as never)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)

    // 外部改名（文件内容 ≠ 最后接纳）
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1', name: '外部名' })] as never)
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    let list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ name: string }>
      storeHealth: { state: string; issues: Array<{ code: string }> }
    }
    expect(list.devices[0].name).toBe('本机名') // 不按外部文件改名
    expect(list.storeHealth.state).toBe('read-only')
    expect(list.storeHealth.issues.map((issue) => issue.code)).toContain('metadata-changed')
    expect(mocks.armStoreProtection).toHaveBeenCalledTimes(1)

    // 文件恢复一致（外部改回）→ 解除保护
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1', name: '本机名' })] as never)
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ name: string }>
      storeHealth: { state: string; issues: Array<{ code: string }> }
    }
    expect(list.storeHealth.state).toBe('ok')
  })

  it('文件消失但有可信设备：同样是库变化，不当首次使用解除保护', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    mocks.readDeviceMetas.mockResolvedValue([] as never) // 文件没了 → metas 空 + ok
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: unknown[]
      storeHealth: { state: string }
    }
    expect(list.devices).toHaveLength(1) // 保留内存设备
    expect(list.storeHealth.state).toBe('read-only')
  })

  it('初载 error 后重查成功：首次建立可信列表', async () => {
    mocks.storeHealth.mockReturnValue({
      state: 'error',
      issues: [{ code: 'invalid-json', message: 'devices.json 不是合法 JSON' }]
    })
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    // 用户修复文件后重查：合法库建立列表
    mocks.storeHealth.mockReturnValue({ state: 'ok', issues: [] })
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; availability?: { state: string } }>
      storeHealth: { state: string }
    }
    expect(list.devices).toHaveLength(1)
    expect(list.devices[0].availability?.state).toBe('valid')
    expect(list.storeHealth.state).toBe('ok')
  })

  it('commitMetas 保留完整运行字段：运行中重命名后 startedAt/serial/availability 不丢（issue 2026-10-08 P3 回归锚）', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
      id: created.createdId,
      name: '运行中改名'
    })
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{
        status: string
        serial?: string
        startedAt?: number
        availability?: { state: string }
      }>
    }
    expect(list.devices[0]).toMatchObject({ status: 'running', serial: 'emulator-5554' })
    expect(list.devices[0].startedAt).toBeGreaterThan(0)
    expect(list.devices[0].availability?.state).toBe('valid')
  })

  it('avd-missing 行内错误：重查恢复 valid 后清除；其他 lastError 不被对账清除', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    // 直接制造 avd-missing 行内错误（模拟上次启动被拒）
    startThroughPreflight()
    mocks.checkDeviceHealth.mockResolvedValueOnce({
      state: 'missing',
      issues: [{ component: 'avd', code: 'ini-missing', message: '缺少 ini', severity: 'error' }],
      checkedAt: 1
    })
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('启动前核验未通过')
    // 重查 valid → avd-missing 清除
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    let list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string } }>
    }
    expect(list.devices[0].lastError).toBeUndefined()
    // 启动失败等命令错误不被对账动
    mocks.runnerInstance.start.mockRejectedValueOnce(new Error('端口耗尽'))
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('端口耗尽')
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string } }>
    }
    expect(list.devices[0].lastError?.code).toBe('start-failed')
  })

  it('删除成功后台重查：元数据与文件代次更新，收尾扫描反映实际状态', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    await handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: created.createdId })
    await vi.waitFor(() =>
      expect(mocks.runReconciliation.mock.calls.length).toBeGreaterThanOrEqual(2)
    )
    const finalRequest = mocks.runReconciliation.mock.calls.at(-1)![0] as { metas: DeviceMeta[] }
    expect(finalRequest.metas).toHaveLength(0)
  })

  it('sender 白名单：reconcile/report/ack 仅登记主窗可用', async () => {
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesReconcile)(wizardEvent(), undefined)
    ).rejects.toThrow('未登记的窗口')
    await expect(
      handlerFor(IPC_CHANNELS.devicesReconciliationReport)(wizardEvent(), undefined)
    ).rejects.toThrow('未登记的窗口')
    await expect(
      handlerFor(IPC_CHANNELS.devicesReconciliationAck)(wizardEvent(), { signature: 's' })
    ).rejects.toThrow('未登记的窗口')
  })
})
