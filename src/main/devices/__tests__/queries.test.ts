// 只读查询注入：listDeviceNamesReferencing + runningDeviceSerial（源码 queries.ts）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'
import { freshDomain, mainWindowEvent, mocks, validCreateInput, quickDevice } from './harness'

describe('listDeviceNamesReferencing（镜像删除守卫）', () => {
  // 单文件时代依赖首块 beforeEach 的实现泄漏（clearAllMocks 不清实现）——
  // 拆分后本文件不再有首块，补同等种子（devicesList 的 'create' sender 校验需要主窗）
  beforeEach(() => {
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
  })

  it('列出引用该包的设备名；creating 态同样计入；无关设备不出现', async () => {
    const pkg = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    mocks.readDeviceMetas.mockResolvedValue([
      quickDevice({ id: 'a', name: '测试机 A' }),
      quickDevice({
        id: 'b',
        name: '测试机 B',
        imagePackageName: 'system-images;android-35;google_apis;arm64-v8a'
      })
    ] as never)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    const { listDeviceNamesReferencing } = await import('..')
    expect(listDeviceNamesReferencing(pkg)).toEqual(['测试机 A'])
    expect(listDeviceNamesReferencing('system-images;android-35;google_apis;arm64-v8a')).toEqual([
      '测试机 B'
    ])
    expect(listDeviceNamesReferencing('system-images;android-99;default;arm64-v8a')).toEqual([])
  })

  it('创建中事务行计入引用（imagePackageName 在 creating 时已写入）', async () => {
    const pkg = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    // 走真实 create 流程挂 creating 行再查询太绕——直接用 creating 态元数据装载
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ id: 'c', name: '创建中机' })] as never)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    const { listDeviceNamesReferencing } = await import('..')
    expect(listDeviceNamesReferencing(pkg)).toEqual(['创建中机'])
  })
})

describe('runningDeviceSerial（APK 安装域注入，plan 2026-10-10-drag-apk-install）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.avdExists.mockResolvedValue(true)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
    mocks.runnerInstance.stop.mockResolvedValue(undefined)
    mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
    mocks.runnerInstance.phaseOf.mockReturnValue(null)
    // 前序 describe 的一次性 mock 会渗进来（clearAllMocks 不重置实现）——回缺省
    mocks.readAvdConfigRaw.mockImplementation(async () => null)
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
  })

  it('running 才返回 serial；未运行/不存在抛错', async () => {
    const { handlerFor, runnerEvents } = await freshDomain()
    // freshDomain 内部已 import('..')——同一模块实例，直接取导出
    const domain = await import('..')
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    // 同步函数：经 async 包装断言抛错
    await expect(async () => domain.runningDeviceSerial('missing')).rejects.toThrow()
    // starting：无 serial
    await expect(async () => domain.runningDeviceSerial(created.createdId)).rejects.toThrow(
      '设备未运行，无法安装 APK'
    )
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: created.createdId })
    runnerEvents().onRunning(created.createdId, 'run-1', 'emulator-5554')
    expect(domain.runningDeviceSerial(created.createdId)).toBe('emulator-5554')
  })
})
