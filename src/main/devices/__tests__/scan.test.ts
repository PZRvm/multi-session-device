// 对账 review 修复轮回归锚（源码 scan.ts 报告/签名/代次防抖）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceAvailability, DeviceMeta } from '@shared/types'
import {
  freshDomain,
  mainWindowEvent,
  mocks,
  startThroughPreflight,
  validCreateInput,
  quickDevice
} from './harness'

describe('对账 review 修复轮（P2/P3 回归锚）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('P2-2：creating 行不进单目标核验——事务中重查不误报 missing、不生成异常签名', async () => {
    // 创建挂在中途（AVD 未落盘），期间人工重查
    let releaseCreate: (() => void) | undefined
    mocks.createAvd.mockReturnValue(
      new Promise<string>((resolve) => {
        releaseCreate = () => resolve('/avd')
      })
    )
    const { handlerFor } = await freshDomain()
    const creating = handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // 重查的扫描请求里不该有 creating 行
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    const request = mocks.runReconciliation.mock.calls.at(-1)![0] as { metas: DeviceMeta[] }
    expect(request.metas).toHaveLength(0)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ status: string; availability?: { state: string } }>
      reconciliation: { signature: string | null; pendingNotification: boolean }
    }
    expect(list.devices[0].status).toBe('creating')
    expect(list.devices[0].availability?.state).toBe('checking')
    expect(list.reconciliation.signature).toBeNull()
    expect(list.reconciliation.pendingNotification).toBe(false)
    releaseCreate?.()
    await creating
  })

  it('P3：三轮代次失配的放弃轮保留上一轮报告内容，只叠加未完成说明', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    const { handlerFor } = await freshDomain()
    // 首载带一个孤立组异常
    mocks.runReconciliation.mockResolvedValueOnce({
      checkedAt: 100,
      availabilityById: new Map(),
      orphans: [{ id: 'orphan-1', kind: 'orphan', detail: '完整组（无元数据记录）' }],
      unrecognizedCount: 0,
      scanError: null
    })
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    // 三轮扫描期间各发生一次 rename（metaRevision 变化）→ 全部失配 → 放弃
    for (let i = 0; i < 3; i += 1) {
      mocks.runReconciliation.mockImplementationOnce(async () => {
        await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
          id: 'd1',
          name: `改名${i}`
        })
        return {
          checkedAt: 200 + i,
          availabilityById: new Map(),
          orphans: [],
          unrecognizedCount: 0,
          scanError: null
        }
      })
    }
    const result = (await handlerFor(IPC_CHANNELS.devicesReconcile)(
      mainWindowEvent(),
      undefined
    )) as {
      report: {
        checkedAt: number
        scanError: string | null
        signature: string | null
        pendingNotification: boolean
      }
    }
    expect(result.report.checkedAt).toBe(100) // 不伪装刚检查过
    expect(result.report.scanError).toContain('未完成')
    expect(result.report.signature).toContain('orphan-1') // 上一轮孤立组保留在签名里
  })

  it('P3：写前 CAS——落盘后文件被外部改动，提交中止并冻结', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    // 模拟外部把文件改成另一份内容（直接替换文件态）
    const external = quickDevice({
      id: created.createdId,
      name: '外部改的名'
    }) as unknown as DeviceMeta
    mocks.fileMetas.current = [external]
    await expect(
      handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
        id: created.createdId,
        name: '内存新名'
      })
    ).rejects.toThrow('外部修改')
    expect(mocks.armStoreProtection).toHaveBeenCalled()
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ name: string }>
      storeHealth: { state: string }
    }
    expect(list.devices[0].name).toBe('测试机') // 内存不被外部内容覆盖
    expect(list.storeHealth.state).toBe('read-only')
  })

  it('P3：异常清零复位确认记录——同内容异常复发时重新提示', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'd1' })] as never)
    const anomalyOutcome = {
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
    }
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    // 第一次异常 → ack
    mocks.runReconciliation.mockResolvedValueOnce(anomalyOutcome)
    const first = (await handlerFor(IPC_CHANNELS.devicesReconcile)(
      mainWindowEvent(),
      undefined
    )) as { report: { signature: string | null } }
    await handlerFor(IPC_CHANNELS.devicesReconciliationAck)(mainWindowEvent(), {
      signature: first.report.signature
    })
    // 恢复正常 → 签名清零（acknowledged 复位）
    await handlerFor(IPC_CHANNELS.devicesReconcile)(mainWindowEvent(), undefined)
    // 同内容异常复发 → 重新待提示
    mocks.runReconciliation.mockResolvedValueOnce(anomalyOutcome)
    const again = (await handlerFor(IPC_CHANNELS.devicesReconcile)(
      mainWindowEvent(),
      undefined
    )) as { report: { signature: string | null; pendingNotification: boolean } }
    expect(again.report.signature).toBe(first.report.signature)
    expect(again.report.pendingNotification).toBe(true)
  })

  it('P3：beforeStart 跨 await 后重取列表对象——核验结果不写孤儿引用', async () => {
    startThroughPreflight()
    let releaseCheck: ((value: DeviceAvailability) => void) | undefined
    mocks.checkDeviceHealth.mockImplementationOnce(
      () =>
        new Promise<DeviceAvailability>((resolve) => {
          releaseCheck = resolve
        })
    )
    const { handlerFor } = await freshDomain()
    const first = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    const second = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    const startPromise = handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), {
      id: first.createdId
    })
    await vi.waitFor(() => expect(mocks.checkDeviceHealth).toHaveBeenCalled())
    // 核验挂起期间提交另一命令（commitMetas 重建 devices 数组）
    await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
      id: second.createdId,
      name: '核验中改名'
    })
    releaseCheck?.({ state: 'valid', issues: [], checkedAt: 7 })
    await startPromise
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; availability?: { state: string } }>
    }
    const target = list.devices.find((device) => device.id === first.createdId)
    expect(target?.availability?.state).toBe('valid') // 写到重建后的对象上，未丢失
  })
})
