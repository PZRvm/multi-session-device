// 创建/删除事务 + 包操作互斥（源码 create.ts；删除流与 lifecycle.ts 相关）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'
import { freshDomain, mainWindowEvent, mocks, validCreateInput } from './harness'

describe('devices 域（创建/删除事务）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
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

  it('复查 P2-1：他设备提交不带创建临时行；创建失败后无幽灵记录', async () => {
    // 已提交的 B 常驻；A 创建挂起在 avdmanager（临时行已在内存）
    const otherId = '018f1c2d-cccc-4000-8000-000000000003'
    mocks.readDeviceMetas.mockResolvedValue([
      {
        id: otherId,
        name: '另一台',
        profileId: 'pixel_8',
        profileLabel: 'Pixel 8',
        imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
        apiDisplay: '36',
        formFactor: 'phone',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        createdAt: 0
      } as never
    ])
    let releaseAvd!: () => void
    mocks.createAvd.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseAvd = () => resolve('/avd')
        })
    )
    const { handlerFor } = await freshDomain()
    const creating = handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    await vi.waitFor(() => expect(mocks.createAvd).toHaveBeenCalled())
    // A 创建中：B 改名提交——落盘内容只有 B（临时行不进 devices.json）
    await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
      id: otherId,
      name: 'B 新名'
    })
    expect(mocks.fileMetas.current).toHaveLength(1)
    expect(mocks.fileMetas.current![0]).toMatchObject({ id: otherId, name: 'B 新名' })
    // A 创建失败（元数据落盘被拒）：撤回临时行，devices.json 仍只有 B
    mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('盘满'))
    releaseAvd()
    await expect(creating).rejects.toThrow('盘满')
    expect(mocks.fileMetas.current).toHaveLength(1)
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string }>
    }
    expect(list.devices.map((device) => device.id)).toEqual([otherId])
    expect(mocks.deleteAvd).toHaveBeenCalled()
  })

  it('复查 P2-1：创建成功提交包含自身行，与他设备先行提交共存', async () => {
    const otherId = '018f1c2d-cccc-4000-8000-000000000003'
    mocks.readDeviceMetas.mockResolvedValue([
      {
        id: otherId,
        name: '另一台',
        profileId: 'pixel_8',
        profileLabel: 'Pixel 8',
        imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
        apiDisplay: '36',
        formFactor: 'phone',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        createdAt: 0
      } as never
    ])
    let releaseAvd!: () => void
    mocks.createAvd.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          releaseAvd = () => resolve('/avd')
        })
    )
    const { handlerFor } = await freshDomain()
    const creating = handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    await vi.waitFor(() => expect(mocks.createAvd).toHaveBeenCalled())
    await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
      id: otherId,
      name: 'B 新名'
    })
    releaseAvd()
    const created = (await creating) as { createdId: string }
    // A 提交成功：两行共存，A 转停止在内存可见
    expect(mocks.fileMetas.current).toHaveLength(2)
    expect(mocks.fileMetas.current!.map((meta) => meta.id).sort()).toEqual(
      [otherId, created.createdId].sort()
    )
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ id: string; status: string; name: string }>
    }
    expect(list.devices.find((device) => device.id === created.createdId)?.status).toBe('stopped')
    expect(list.devices.find((device) => device.id === otherId)?.name).toBe('B 新名')
  })

  it('create：v2 字段落盘——精确包身份/API 显示/形态/屏幕摘要；返回前核验画像与安装', async () => {
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
    expect(persisted[0]).toMatchObject({
      imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      apiDisplay: '36',
      formFactor: 'phone',
      advancedSettings: null
    })
    expect(persisted[0]?.screenSummary).toMatchObject({ widthPx: 1080, heightPx: 2400 })
    // 核验链走了本地扫描与画像重查（拒绝陈旧选择的数据源）
    expect(mocks.scanLocalImages).toHaveBeenCalled()
    expect(mocks.listDeviceProfiles).toHaveBeenCalledWith(
      expect.objectContaining({ sdkRoot: '/userdata/AndroidSDK' })
    )
  })

  it('create：画像已不可创建 → 拒绝，不建 AVD 不落盘（拒绝陈旧选择）', async () => {
    mocks.listDeviceProfiles.mockResolvedValueOnce([])
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('画像已不可创建')
    expect(mocks.createAvd).not.toHaveBeenCalled()
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('出身标注：托管态建出 app-owned（plan 2026-10-12-device-list-source-aware）', async () => {
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
    expect(persisted[0].imageSourceOrigin).toBe('app-owned')
  })

  it('出身标注：共享态建出 shared-studio；toMeta 透传重落盘不丢', async () => {
    const { handlerFor } = await freshDomain()
    // freshDomain resetModules 后须取同一个新实例设态——静态 import 的 sdkSource 已是旧模块
    const sdkSource = await import('../../emulator/sdkSource')
    sdkSource.setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: '/studio/sdk'
    })
    try {
      const result = (await handlerFor(IPC_CHANNELS.devicesCreate)(
        mainWindowEvent(),
        validCreateInput
      )) as { createdId: string }
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0].imageSourceOrigin).toBe('shared-studio')
      // 改名触发 toMeta 重写：出身随之透传（不可变字段不因编辑丢失）
      await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
        id: result.createdId,
        name: '共享机'
      })
      const renamed = mocks.fileMetas.current!
      expect(renamed.find((meta) => meta.id === result.createdId)?.imageSourceOrigin).toBe(
        'shared-studio'
      )
    } finally {
      sdkSource.resetSdkSourceStateForTest()
    }
  })

  it('清除保留根级联（用户批复）：purgeAppOwnedDevices 只删项目自有设备，绕过跨桶只读守卫', async () => {
    const ownedId = '018f1c2d-dddd-4000-8000-000000000011'
    const sharedId = '018f1c2d-eeee-4000-8000-000000000012'
    mocks.readDeviceMetas.mockResolvedValue([
      {
        id: ownedId,
        name: '自有机',
        profileId: 'pixel_8',
        profileLabel: 'Pixel 8',
        imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
        apiDisplay: '36',
        formFactor: 'phone',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        createdAt: 0
      },
      {
        id: sharedId,
        name: '共享机',
        profileId: 'pixel_8',
        profileLabel: 'Pixel 8',
        imagePackageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a',
        apiDisplay: '36.1',
        formFactor: 'phone',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        imageSourceOrigin: 'shared-studio',
        createdAt: 0
      }
    ] as never)
    const { handlerFor } = await freshDomain()
    const domain = (await import('..')) as typeof import('..')
    const sdkSource = await import('../../emulator/sdkSource')
    sdkSource.setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: '/studio/sdk'
    })
    try {
      // 级联前的确认框计数：只有 1 台项目自有
      await expect(domain.appOwnedDeviceCount()).resolves.toBe(1)
      // 跨桶只读下单台删除被拒（对照）——purge 是系统性清理，必须绕过
      await expect(
        handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: ownedId })
      ).rejects.toThrow('另一 SDK 来源')

      const result = await domain.purgeAppOwnedDevices()
      expect(result.deleted.map((entry) => entry.id)).toEqual([ownedId])
      expect(result.failures).toEqual([])
      // 共享机独存：内存与落盘都只剩它
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string }>
      }
      expect(list.devices.map((device) => device.id)).toEqual([sharedId])
      expect(mocks.fileMetas.current!.map((meta) => meta.id)).toEqual([sharedId])
    } finally {
      sdkSource.resetSdkSourceStateForTest()
    }
  })

  it('跨来源桶设备只读（用户复核 5）：共享态下对 app-owned 出身设备改名/删除被服务端拒绝', async () => {
    const otherId = '018f1c2d-cccc-4000-8000-000000000009'
    mocks.readDeviceMetas.mockResolvedValue([
      {
        id: otherId,
        name: '自有设备',
        profileId: 'pixel_8',
        profileLabel: 'Pixel 8',
        imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
        apiDisplay: '36',
        formFactor: 'phone',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        createdAt: 0
      } as never
    ])
    const { handlerFor } = await freshDomain()
    const sdkSource = await import('../../emulator/sdkSource')
    sdkSource.setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: '/studio/sdk'
    })
    try {
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), { id: otherId, name: '新名' })
      ).rejects.toThrow('另一 SDK 来源')
      await expect(
        handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: otherId })
      ).rejects.toThrow('另一 SDK 来源')
      expect(mocks.deleteAvd).not.toHaveBeenCalled()
      expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
    } finally {
      sdkSource.resetSdkSourceStateForTest()
    }
  })

  it('快照携带活动来源桶（plan 2026-10-12-device-list-origin-view-filter）：managed/custom → app-owned，shared → shared-studio', async () => {
    const { handlerFor } = await freshDomain()
    const sdkSource = await import('../../emulator/sdkSource')
    const listSnapshot = async (): Promise<{ sourceBucket: string }> =>
      (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        sourceBucket: string
      }
    expect((await listSnapshot()).sourceBucket).toBe('app-owned')
    sdkSource.setSdkSourceState({
      version: 1,
      source: 'custom',
      customPath: '/vol/sdk',
      sharedPath: null
    })
    expect((await listSnapshot()).sourceBucket).toBe('app-owned')
    sdkSource.setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: '/studio/sdk'
    })
    expect((await listSnapshot()).sourceBucket).toBe('shared-studio')
    sdkSource.resetSdkSourceStateForTest()
  })

  it('create：能力经唯一入口 buildEnrichedCapabilities 构建并喂给归一化（P1 接线锚）', async () => {
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    expect(mocks.buildEnrichedCapabilities).toHaveBeenCalledTimes(1)
    const caps = await mocks.buildEnrichedCapabilities.mock.results.at(-1)!.value
    // 归一化消费的正是富化能力的解析值——向导与创建两侧口径同源
    expect(mocks.normalizeAdvancedSettings.mock.calls.at(-1)![1]).toBe(caps)
  })

  it('create：创建意向全程持有，失败路径同样释放（P2-2 接线锚）', async () => {
    mocks.createAvd.mockRejectedValueOnce(new Error('boom'))
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('boom')
    expect(mocks.beginPackageCreation).toHaveBeenCalledWith(validCreateInput.imagePackageName)
    expect(mocks.endPackageCreation).toHaveBeenCalledWith(validCreateInput.imagePackageName)
    // begin 先于 AVD 创建、end 后于回滚（invocationCallOrder 校验次序）
    expect(mocks.beginPackageCreation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createAvd.mock.invocationCallOrder[0]
    )
    expect(mocks.endPackageCreation.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.deleteAvd.mock.invocationCallOrder[0]
    )
  })

  it('create：镜像半安装（核验不过）→ 拒绝', async () => {
    mocks.scanLocalImages.mockResolvedValueOnce(new Map())
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('未安装或安装不完整')
    expect(mocks.createAvd).not.toHaveBeenCalled()
  })

  it('外观提示：创建的设备快照携带派生 frameKind，落盘元数据不含', async () => {
    const { handlerFor } = await freshDomain()
    const result = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { snapshot: { devices: Array<{ profileId: string; frameKind?: string }> } }
    expect(mocks.loadFrameKindIndex).toHaveBeenCalled()
    expect(result.snapshot.devices.at(-1)!.frameKind).toBe('phone')
    const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
    expect((persisted[0] as unknown as Record<string, unknown>).frameKind).toBeUndefined()
  })

  it('外观提示：加载既有设备同样派生，未知画像 generic 兜底', async () => {
    mocks.readDeviceMetas.mockResolvedValue([
      {
        id: 'd1',
        name: '旧机',
        profileId: 'mystery',
        profileLabel: 'Mystery',
        imagePackageName: 'system-images;android-35;google_apis;arm64-v8a',
        apiDisplay: '35',
        formFactor: 'unknown',
        screenSummary: null,
        advancedSettings: null,
        snapshotReadyAt: null,
        createdAt: 1
      }
    ])
    const { handlerFor } = await freshDomain()
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ profileId: string; frameKind?: string }>
    }
    expect(list.devices[0].frameKind).toBe('generic')
  })

  it('外观提示：SDK 缺失收敛空索引——快照 generic、创建不受阻', async () => {
    // ensureLoaded 与 createDevice 各触发一次索引刷新，用持久 mock 而非 Once
    mocks.loadFrameKindIndex.mockResolvedValue({ lookup: () => 'generic', entries: 0 })
    const { handlerFor } = await freshDomain()
    const result = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { snapshot: { devices: Array<{ frameKind?: string }> } }
    expect(result.snapshot.devices.at(-1)!.frameKind).toBe('generic')
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

  it('list：首载窗口并发调用只读一次盘（issue 2026-10-03 双读的收口）', async () => {
    let releaseRead: (() => void) | undefined
    mocks.readDeviceMetas.mockReturnValue(
      new Promise<DeviceMeta[]>((resolve) => {
        releaseRead = () => resolve([])
      })
    )
    const { handlerFor } = await freshDomain()
    // 读挂在 pending 上时第二个调用进来——两者必须共享同一次加载
    const first = handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    const second = handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)
    releaseRead?.()
    const snapshots = (await Promise.all([first, second])) as Array<{ devices: unknown[] }>
    expect(mocks.readDeviceMetas).toHaveBeenCalledTimes(1)
    expect(snapshots).toHaveLength(2)
  })

  it('delete：AVD 已删但写盘失败 → 保留 delete-failed；写盘恢复后队列仍可用', async () => {
    const { handlerFor } = await freshDomain()
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(
      mainWindowEvent(),
      validCreateInput
    )) as { createdId: string }
    mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('磁盘满'))
    await expect(
      handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: created.createdId })
    ).rejects.toThrow('磁盘满')
    expect(mocks.deleteAvd).toHaveBeenCalledTimes(1)
    const afterFailure = (await handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as { devices: Array<{ status: string; lastError?: { code: string } }> }
    expect(afterFailure.devices).toHaveLength(1)
    expect(afterFailure.devices[0].status).toBe('stopped')
    expect(afterFailure.devices[0].lastError?.code).toBe('delete-failed')
    // writeQueue 单次失败不断队列：写盘恢复后 rename 正常提交
    await handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
      id: created.createdId,
      name: '队列存活'
    })
    const afterRename = (await handlerFor(IPC_CHANNELS.devicesList)(
      mainWindowEvent(),
      undefined
    )) as { devices: Array<{ name: string }> }
    expect(afterRename.devices[0].name).toBe('队列存活')
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

describe('createDevice 与包操作互斥（review P2 TOCTOU 收口）', () => {
  it('同包卸载进行中 → 拒绝创建；不同包不拦', async () => {
    mocks.readDeviceMetas.mockResolvedValue([])
    const pkg = 'system-images;android-36;google_apis_playstore;arm64-v8a'
    const { handlerFor } = await freshDomain()
    mocks.activePackageOp.mockReturnValue({ kind: 'uninstall', packageName: pkg })
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('镜像正在卸载')
    expect(mocks.createAvd).not.toHaveBeenCalled()
    // 不同包的卸载不拦创建
    mocks.activePackageOp.mockReturnValue({
      kind: 'uninstall',
      packageName: 'system-images;android-35;google_apis;arm64-v8a'
    })
    await handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    expect(mocks.createAvd).toHaveBeenCalledTimes(1)
    mocks.activePackageOp.mockReturnValue(null)
  })

  it('同包下载进行中 → 拒绝创建', async () => {
    mocks.readDeviceMetas.mockResolvedValue([])
    const { handlerFor } = await freshDomain()
    mocks.activePackageOp.mockReturnValue({
      kind: 'download',
      packageName: 'system-images;android-36;google_apis_playstore;arm64-v8a'
    })
    await expect(
      handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), validCreateInput)
    ).rejects.toThrow('镜像正在下载')
    expect(mocks.createAvd).not.toHaveBeenCalled()
    mocks.activePackageOp.mockReturnValue(null)
  })
})
