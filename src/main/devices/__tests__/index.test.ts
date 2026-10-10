// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceAvailability, DeviceMeta } from '@shared/types'

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
    // 编辑域 sender 守卫：向导窗当前固定上下文（默认 create；编辑用例按需覆写）
    wizardContext: {
      current: { kind: 'create' } as { kind: 'create' } | { kind: 'edit'; deviceId: string } | null
    },
    // 编辑域接缝：config 原文与写入口（默认无可读 config）
    readAvdConfigRaw: vi.fn<(name: string) => Promise<string | null>>(async () => null),
    writeAvdConfigRaw: vi.fn<(avdName: string, dirs: unknown, content: string) => Promise<void>>(
      async () => {}
    ),
    readHardwareSchemaDefaults: vi.fn<() => Promise<Record<string, string>>>(async () => ({})),
    writeJournal: vi.fn(async () => {}),
    removeJournal: vi.fn(async () => {}),
    resetDisplayCutout: vi.fn(async () => {}),
    recoverPendingTransactions: vi.fn(async () => ({
      completed: [] as string[],
      rolledBack: [] as string[],
      frozen: [] as Array<{ deviceId: string; message: string }>
    })),
    clipboardWriteText: vi.fn(),
    // store 适配层的文件态模拟（修复轮）：writeDeviceMetas 默认落盘后，readDeviceStore
    // 改读落盘内容——写前 CAS/受控重读语义与真实 store 对齐；null = 尚未写过，读初始 mock
    fileMetas: { current: null as DeviceMeta[] | null },
    // store 适配层：readDeviceStore 把 metas/health 拆给可独立覆写的 mock
    readDeviceMetas: vi.fn<() => Promise<DeviceMeta[]>>(async () => []),
    storeHealth: vi.fn<() => { state: 'ok' | 'read-only' | 'error'; issues: unknown[] }>(() => ({
      state: 'ok',
      issues: []
    })),
    storeSuspectIds: vi.fn<() => string[]>(() => []),
    armStoreProtection: vi.fn(),
    // 对账服务：默认全部健康（valid），异常用例按需覆写
    runReconciliation: vi.fn(async (request: { metas: DeviceMeta[] }): Promise<unknown> => ({
      checkedAt: 42,
      availabilityById: new Map(
        request.metas.map((meta) => [meta.id, { state: 'valid', issues: [], checkedAt: 42 }])
      ),
      orphans: [],
      unrecognizedCount: 0,
      scanError: null
    })),
    checkDeviceHealth: vi.fn<() => Promise<DeviceAvailability>>(async () => ({
      state: 'valid',
      issues: [],
      checkedAt: 42
    })),
    writeDeviceMetas: vi.fn<(metas: DeviceMeta[]) => Promise<void>>(async (metas) => {
      mocks.fileMetas.current = metas
    }),
    createAvd: vi.fn(async () => '/avd'),
    patchAvdConfig: vi.fn(async () => {}),
    readEmulatorVersion: vi.fn(async () => '36.1.9'),
    buildCapabilities: vi.fn(() => ({
      capabilityContextId: 'pixel_8|pkg|36.1.9',
      emulatorVersion: '36.1.9',
      defaults: null,
      fields: {},
      quickBootAvailable: false,
      quickBootDisabledReason: '门槛未过',
      webcamDeviceIds: [],
      skinIds: []
    })),
    buildEnrichedCapabilities: vi.fn(async () => ({
      capabilityContextId: 'pixel_8|pkg|36.1.9|enriched',
      emulatorVersion: '36.1.9',
      defaults: null,
      fields: {},
      quickBootAvailable: false,
      quickBootDisabledReason: '门槛未过',
      webcamDeviceIds: [],
      skinIds: []
    })),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- P1 接线锚：mock 需携带第二参（capabilities）供 calls[1] 断言
    normalizeAdvancedSettings: vi.fn((raw: unknown, _capabilities: unknown) => ({
      settings: raw === null ? null : raw,
      errors: {}
    })),
    settingsToConfigPatch: vi.fn(() => ({})),
    settingsToRunnerArgs: vi.fn((settings: { bootMode?: string } | null): string[] =>
      // 与真实契约一致：cold 带 -no-snapshot；quick 不带快照禁止参数
      settings !== null && settings.bootMode === 'quick' ? [] : ['-no-snapshot', '-gpu', 'host']
    ),
    listWebcams: vi.fn(async () => [{ id: 'webcam0', deviceLabel: 'host-a' }]),
    deleteAvd: vi.fn<(dirs: unknown) => Promise<void>>(async () => {}),
    avdExists: vi.fn(async () => true),
    isPackageNameInstalled: vi.fn<(root: string, packageName: string) => Promise<boolean>>(
      async () => true
    ),
    scanLocalImages: vi.fn<(root: string) => Promise<Map<string, unknown>>>(
      async () =>
        new Map([
          [
            'system-images;android-36;google_apis_playstore;arm64-v8a',
            {
              packageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
              displayName: null,
              apiLevelText: '36',
              extensionLevel: null,
              tagIds: ['google_apis_playstore'],
              abi: 'arm64-v8a',
              revision: null,
              verified: true
            }
          ]
        ])
    ),
    listDeviceProfiles: vi.fn(async () => [
      {
        id: 'pixel_8',
        name: 'Pixel 8',
        manufacturer: 'Google',
        tagIds: [],
        formFactor: 'phone',
        screen: {
          widthPx: 1080,
          heightPx: 2400,
          diagonalInches: 6.2,
          logicalDpi: 420,
          round: null
        },
        foldable: false,
        apiMin: null,
        apiMax: null,
        playSupported: null,
        deprecated: false,
        hasFrontCamera: null,
        hasBackCamera: null,
        ramMiB: null,
        creatable: true
      }
    ]),
    listAdbSerials: vi.fn(async () => new Set<string>()),
    ensureSharedServer: vi.fn(async () => ({ reused: false, protocolVersion: 41 })),
    resolveAdbExecutable: vi.fn(async () => ({
      path: '/adb',
      source: 'app-sdk',
      protocolVersion: 41
    })),
    loadFrameKindIndex: vi.fn(
      async (): Promise<{
        lookup: (profileId: string) => 'phone' | 'tablet' | 'generic'
        entries: number
      }> => ({
        lookup: (profileId) =>
          profileId === 'pixel_tablet' ? 'tablet' : profileId === 'pixel_8' ? 'phone' : 'generic',
        entries: 2
      })
    ),
    // fake runner：devices 层以 createRunner() 工厂接入，测试持有实例与构造回调
    runnerInstance: {
      start: vi.fn<(id: string, runId: string) => Promise<{ runId: string; serial: string }>>(
        async () => ({ runId: 'run-1', serial: 'emulator-5554' })
      ),
      stop: vi.fn(async () => undefined),
      cancelStart: vi.fn(async () => undefined),
      phaseOf: vi.fn((): 'starting' | 'running' | 'stopping' | null => null),
      serialOf: vi.fn((): string | undefined => undefined),
      disposeAll: vi.fn(async () => [] as string[]),
      resumeAccepting: vi.fn()
    },
    createRunner: vi.fn(),
    activePackageOp: vi.fn(
      (): { kind: 'download' | 'uninstall'; packageName: string } | null => null
    ),
    beginPackageCreation: vi.fn(),
    endPackageCreation: vi.fn(),
    isPackageCreating: vi.fn((): boolean => false)
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
  readDeviceStore: async (): Promise<unknown> => ({
    metas: mocks.fileMetas.current ?? (await mocks.readDeviceMetas()),
    health: mocks.storeHealth(),
    sourceVersion: 2,
    suspectIds: mocks.storeSuspectIds()
  }),
  writeDeviceMetas: mocks.writeDeviceMetas,
  armStoreProtection: mocks.armStoreProtection
}))
vi.mock('../../emulator/reconcile', () => ({
  CHECK_TIMEOUT_MS: 3000,
  runReconciliation: mocks.runReconciliation,
  checkDeviceHealth: mocks.checkDeviceHealth
}))
vi.mock('../../emulator/avd', () => ({
  avdExists: mocks.avdExists,
  createAvd: mocks.createAvd,
  deleteAvd: mocks.deleteAvd,
  patchAvdConfig: mocks.patchAvdConfig
}))
vi.mock('../../emulator/displayCutout', () => ({ resetDisplayCutout: mocks.resetDisplayCutout }))
vi.mock('../../emulator/settings', () => ({
  readEmulatorVersion: mocks.readEmulatorVersion,
  buildCapabilities: mocks.buildCapabilities,
  buildEnrichedCapabilities: mocks.buildEnrichedCapabilities,
  normalizeAdvancedSettings: mocks.normalizeAdvancedSettings,
  settingsToConfigPatch: mocks.settingsToConfigPatch,
  settingsToRunnerArgs: mocks.settingsToRunnerArgs
}))
vi.mock('../../emulator/catalog', () => ({
  isPackageNameInstalled: mocks.isPackageNameInstalled,
  scanLocalImages: mocks.scanLocalImages,
  splitPackageName: (
    packageName: string
  ): {
    platformSegment: string
    tagSegment: string
    abi: string
  } | null => {
    const parts = packageName.split(';')
    if (parts.length !== 4 || parts[0] !== 'system-images') return null
    return { platformSegment: parts[1], tagSegment: parts[2], abi: parts[3] }
  },
  classifyTags: (tagIds: string[]) => ({
    services: tagIds.includes('google_apis_playstore')
      ? ['google_play']
      : tagIds.includes('google_apis')
        ? ['google_apis']
        : tagIds.includes('default')
          ? ['aosp']
          : [],
    featureTags: []
  }),
  parseApiVersion: (text: string | null) =>
    text === '36.1'
      ? { major: 36, minor: 1 }
      : text === null
        ? { major: null, minor: null }
        : { major: Number(text), minor: null }
}))
vi.mock('../../emulator/compatibility', () => ({
  assessImageCompatibility: () => ({ status: 'supported', reasons: [] })
}))
vi.mock('../../emulator/profiles', () => ({
  listDeviceProfiles: mocks.listDeviceProfiles,
  avdmanagerPathFor: () => '/avdmanager'
}))
vi.mock('../../emulator/profileMetadata', () => ({
  sdklibJarPathFor: () => '/sdklib.jar',
  loadFrameKindIndex: mocks.loadFrameKindIndex
}))
vi.mock('../../emulator/packageOps', () => ({
  activePackageOp: mocks.activePackageOp,
  beginPackageOp: vi.fn(),
  endPackageOp: vi.fn(),
  beginPackageCreation: mocks.beginPackageCreation,
  endPackageCreation: mocks.endPackageCreation,
  isPackageCreating: mocks.isPackageCreating
}))
vi.mock('../../emulator/adb', () => ({
  candidateAdbPaths: () => [{ path: '/adb', source: 'app-sdk' }],
  ensureSharedServer: mocks.ensureSharedServer,
  listAdbSerials: mocks.listAdbSerials,
  resolveAdbExecutable: mocks.resolveAdbExecutable
}))
vi.mock('../../emulator/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../emulator/runner')>()),
  createRunner: mocks.createRunner
}))
// 编辑域接缝：纯函数走真实实现（解析/指纹/patch 语义可信），IO 点全部可注入
vi.mock('../../emulator/deviceConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../emulator/deviceConfig')>()),
  readAvdConfigRaw: mocks.readAvdConfigRaw,
  writeAvdConfigRaw: mocks.writeAvdConfigRaw,
  readHardwareSchemaDefaults: mocks.readHardwareSchemaDefaults
}))
vi.mock('../../emulator/configTransaction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../emulator/configTransaction')>()),
  recoverPendingTransactions: mocks.recoverPendingTransactions,
  writeJournal: mocks.writeJournal,
  removeJournal: mocks.removeJournal
}))
vi.mock('../../emulator/cameras', () => ({ listWebcams: mocks.listWebcams }))
vi.mock('../../window', () => ({ getMainWindow: mocks.getMainWindow }))
vi.mock('../../window/wizard', () => ({
  wizardOwns: mocks.wizardOwns,
  wizardContextOf: (sender: { id?: number } | null | undefined) =>
    sender !== null && sender !== undefined && sender.id === 9 ? mocks.wizardContext.current : null
}))

/** devices 域有模块级状态——每用例 resetModules 动态导入隔离 */
const freshDomain = async (): Promise<{
  handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  runnerEvents: () => {
    onRunning: (id: string, runId: string, serial: string) => void
    onUnexpectedExit: (
      id: string,
      runId: string,
      info: { code: number; stderrTail: string; stdoutTail: string }
    ) => void
  }
  runner: typeof mocks.runnerInstance
}> => {
  vi.resetModules()
  mocks.fileMetas.current = null
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
          info: { code: number; stderrTail: string; stdoutTail: string }
        ) => void
      }
      return config
    },
    runner: mocks.runnerInstance
  }
}

const mainWindowEvent = (): unknown => ({ sender: { id: 7 } })
const wizardEvent = (): unknown => ({ sender: { id: 9 } })

/** 真实链路里 runner 准备会执行 beforeStart——mock start 在此同步走一遍以驱动核验 */
const startThroughPreflight = (): void => {
  mocks.runnerInstance.start.mockImplementation(
    async (id: string, runId: string): Promise<{ runId: string; serial: string }> => {
      const config = mocks.createRunner.mock.calls.at(-1)![0] as {
        beforeStart?: (id: string, runId: string, signal: AbortSignal) => Promise<void>
      }
      await config.beforeStart?.(id, runId, new AbortController().signal)
      return { runId: 'run-1', serial: 'emulator-5554' }
    }
  )
}

const validCreateInput = {
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
  name: '测试机'
}

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

const quickDevice = (
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> => ({
  id: 'quick-1',
  name: 'Quick 机',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
  apiDisplay: '36',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: {
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'quick',
    internalStorageMiB: 6144,
    cpuCores: 4,
    graphics: 'auto',
    ramMiB: 2048,
    vmHeapMiB: 256,
    preferredAbi: 'optimal'
  },
  snapshotReadyAt: null,
  createdAt: 0,
  status: 'stopped',
  ...overrides
})

describe('Quick Boot 运行路径（plan 设计 8；门槛未过保持禁用）', () => {
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

describe('listDeviceNamesReferencing（镜像删除守卫）', () => {
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

describe('启动前摄像头核验（review P3：文案不叠加建议从句）', () => {
  /** 前置绑定 webcam0 的设备（normalizeAdvancedSettings 为透传 mock） */
  const createWebcamDevice = async (
    handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  ): Promise<string> => {
    const created = (await handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), {
      ...validCreateInput,
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'webcam', deviceId: 'webcam0' },
        rearCamera: { mode: 'emulated', deviceId: null },
        networkSpeed: null,
        networkLatency: null,
        orientation: null,
        bootMode: 'cold',
        internalStorageMiB: 6144,
        cpuCores: 4,
        graphics: 'auto',
        ramMiB: 2048,
        vmHeapMiB: 256,
        preferredAbi: 'optimal'
      }
    })) as { createdId: string }
    return created.createdId
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // 状态机组遗留的 checkDeviceHealth 缺失态会先拦掉启动——回默认健康
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.readDeviceMetas.mockResolvedValue([])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.isPackageNameInstalled.mockResolvedValue(true)
    mocks.createAvd.mockResolvedValue('/avd')
    mocks.avdExists.mockResolvedValue(true)
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.wizardOwns.mockImplementation((sender: { id: number }) => sender.id === 9)
    mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
    mocks.listWebcams.mockResolvedValue([{ id: 'webcam0', deviceLabel: 'host-a' }])
    // 摄像头核验移入 beforeStart（对账设计 4）：让 mock start 驱动它
    startThroughPreflight()
  })

  it('枚举失败且底层错误自带建议从句：不再叠加第二条建议', async () => {
    mocks.listWebcams.mockRejectedValue(new Error('摄像头输出格式无法识别，请检查 emulator 版本'))
    const { handlerFor } = await freshDomain()
    const id = await createWebcamDevice(handlerFor)
    await expect(handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id })).rejects.toThrow(
      '启动前无法核验摄像头'
    )
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string; message: string } }>
    }
    expect(list.devices[0].lastError?.code).toBe('webcam-missing')
    expect(list.devices[0].lastError?.message).toBe(
      '启动前无法核验摄像头：摄像头输出格式无法识别，请检查 emulator 版本'
    )
  })

  it('枚举失败为裸错误：保留原错误并附行动建议', async () => {
    mocks.listWebcams.mockRejectedValue(new Error('spawn ENOENT'))
    const { handlerFor } = await freshDomain()
    const id = await createWebcamDevice(handlerFor)
    await expect(handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id })).rejects.toThrow(
      '启动前无法核验摄像头：spawn ENOENT，请检查权限或改用模拟画面'
    )
  })

  it('配置的宿主摄像头消失：原样透传，不进枚举失败分支', async () => {
    mocks.listWebcams.mockResolvedValue([])
    const { handlerFor } = await freshDomain()
    const id = await createWebcamDevice(handlerFor)
    await expect(handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id })).rejects.toThrow(
      '宿主摄像头（webcam0）已不可用'
    )
    const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
      devices: Array<{ lastError?: { code: string; message: string } }>
    }
    expect(list.devices[0].lastError?.message).not.toContain('启动前无法核验')
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

describe('配置编辑域（plan 2026-10-08-device-config-edit）', () => {
  const DEVICE_ID = '018f1c2d-aaaa-4000-8000-000000000001'
  const OTHER_ID = '018f1c2d-bbbb-4000-8000-000000000002'
  const CONFIG_RAW = [
    'avd.ini.encoding=UTF-8',
    'hw.ramSize=2048',
    'hw.cpu.ncore=4',
    'vm.heapSize=256',
    'hw.gpu.mode=auto',
    'hw.camera.front=emulated',
    'hw.camera.back=emulated',
    'disk.dataPartition.size=6144M',
    ''
  ].join('\n')

  const editSettings = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'cold',
    internalStorageMiB: 6144,
    cpuCores: 4,
    graphics: 'auto',
    ramMiB: 2048,
    vmHeapMiB: 256,
    preferredAbi: 'optimal',
    ...overrides
  })

  const editDevice = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: DEVICE_ID,
    name: '编辑机',
    profileId: 'pixel_8',
    profileLabel: 'Pixel 8',
    imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
    apiDisplay: '36',
    formFactor: 'phone',
    screenSummary: null,
    advancedSettings: editSettings(),
    snapshotReadyAt: 999,
    createdAt: 0,
    status: 'stopped',
    ...overrides
  })

  const editCaps = (): Record<string, unknown> => ({
    capabilityContextId: 'pixel_8|pkg|36.1.9|edit',
    emulatorVersion: '36.1.9',
    defaults: editSettings(),
    fields: {
      skinRef: { disabledReason: null, min: null, max: null, step: null },
      frontCamera: { disabledReason: null, min: null, max: null, step: null },
      rearCamera: { disabledReason: null, min: null, max: null, step: null },
      networkSpeed: { disabledReason: null, min: null, max: null, step: null },
      networkLatency: { disabledReason: null, min: null, max: null, step: null },
      orientation: { disabledReason: null, min: null, max: null, step: null },
      bootMode: { disabledReason: '门槛未过', min: null, max: null, step: null },
      internalStorageMiB: { disabledReason: null, min: 2048, max: 65536, step: 1 },
      cpuCores: { disabledReason: null, min: 1, max: 8, step: 1 },
      graphics: { disabledReason: null, min: null, max: null, step: null },
      ramMiB: { disabledReason: null, min: 2048, max: 32768, step: 1 },
      vmHeapMiB: { disabledReason: null, min: 64, max: 1024, step: 1 },
      preferredAbi: { disabledReason: '跨架构二期', min: null, max: null, step: null }
    },
    quickBootAvailable: false,
    quickBootDisabledReason: '门槛未过',
    webcamDeviceIds: ['webcam0', 'webcam1'],
    cameraSnapshot: {
      permission: 'granted',
      error: null,
      devices: [
        { id: 'webcam0', deviceLabel: 'FaceTime HD' },
        { id: 'webcam1', deviceLabel: '外接相机' }
      ]
    },
    skinIds: []
  })

  /** 编辑窗事件（sender id 9 + 绑定 DEVICE_ID 的 edit 上下文） */
  const editEvent = (): unknown => ({ sender: { id: 9 } })

  const fingerprintOfSnapshot = async (
    handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  ): Promise<string> => {
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
      id: DEVICE_ID
    })) as { fingerprint: string }
    return snapshot.fingerprint
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.readDeviceMetas.mockResolvedValue([editDevice() as never])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.getAllWindows.mockReturnValue([])
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.readAvdConfigRaw.mockResolvedValue(CONFIG_RAW)
    mocks.writeAvdConfigRaw.mockResolvedValue(undefined)
    mocks.readHardwareSchemaDefaults.mockResolvedValue({})
    mocks.recoverPendingTransactions.mockResolvedValue({
      completed: [],
      rolledBack: [],
      frozen: []
    })
    mocks.writeJournal.mockResolvedValue(undefined)
    mocks.removeJournal.mockResolvedValue(undefined)
    mocks.resetDisplayCutout.mockResolvedValue(undefined)
    mocks.buildEnrichedCapabilities.mockResolvedValue(editCaps() as never)
    mocks.normalizeAdvancedSettings.mockImplementation((raw: unknown) => ({
      settings: raw === null ? null : raw,
      errors: {}
    }))
    mocks.listWebcams.mockResolvedValue([{ id: 'webcam0', deviceLabel: 'FaceTime HD' }])
    mocks.wizardContext.current = { kind: 'edit', deviceId: DEVICE_ID }
    mocks.runnerInstance.disposeAll.mockResolvedValue([])
  })

  describe('readConfig（快照回填）', () => {
    it('绑定编辑窗可读：已存设置按 metadata 回填，存储只读展示，指纹稳定', async () => {
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as {
        settings: { ramMiB: number }
        internalStorage: { valueMiB: number | null; note: string }
        saveBlockedReason: string | null
        fingerprint: string
        identity: { name: string; profileLabel: string }
      }
      expect(snapshot.settings.ramMiB).toBe(2048)
      expect(snapshot.internalStorage.valueMiB).toBe(6144)
      expect(snapshot.internalStorage.note).toContain('不支持修改内部存储')
      expect(snapshot.saveBlockedReason).toBeNull()
      expect(snapshot.identity.name).toBe('编辑机')
      expect(mocks.listDeviceProfiles).toHaveBeenCalledWith(
        expect.objectContaining({ sdkRoot: '/userdata/AndroidSDK' })
      )
      expect(snapshot.fingerprint).toBe(await fingerprintOfSnapshot(handlerFor))
    })

    it('运行中快照分离 status 与文件阻断', async () => {
      const { handlerFor } = await freshDomain()
      startThroughPreflight()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { saveBlockedReason: string | null; status: string }
      expect(snapshot.saveBlockedReason).toBeNull()
      expect(snapshot.status).toBe('starting')
    })

    it('主窗与绑定其他设备的编辑窗都被拒绝', async () => {
      const { handlerFor } = await freshDomain()
      await expect(
        handlerFor(IPC_CHANNELS.devicesReadConfig)(mainWindowEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('本窗口无权读写该设备的配置')
      mocks.wizardContext.current = { kind: 'edit', deviceId: OTHER_ID }
      await expect(
        handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('本窗口无权读写该设备的配置')
    })

    it('legacy（null 设置）：Cold/host 语义 + config 回填；缺省键不冒充', async () => {
      mocks.readDeviceMetas.mockResolvedValue([editDevice({ advancedSettings: null }) as never])
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as {
        settings: { bootMode: string; graphics: string; ramMiB: number; networkSpeed: null }
        internalStorage: { valueMiB: number | null }
      }
      expect(snapshot.settings.bootMode).toBe('cold')
      expect(snapshot.settings.graphics).toBe('host') // runner 的显式 host 覆盖 config auto
      expect(snapshot.settings.ramMiB).toBe(2048)
      expect(snapshot.settings.networkSpeed).toBeNull()
      expect(snapshot.internalStorage.valueMiB).toBe(6144)
    })

    it('config 缺失：快照可读但保存被阻断并说明', async () => {
      mocks.readAvdConfigRaw.mockResolvedValue(null)
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { saveBlockedReason: string | null }
      expect(snapshot.saveBlockedReason).toContain('config.ini 缺失')
    })
  })

  describe('updateConfig（守卫与差异闭集）', () => {
    it('载荷含内部存储/ABI/未知键直接拒绝', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      const base = { id: DEVICE_ID, fingerprint }
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          ...base,
          advancedSettings: { internalStorageMiB: 8192 }
        })
      ).rejects.toThrow('内部存储不允许修改')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          ...base,
          advancedSettings: { preferredAbi: 'arm64-v8a' }
        })
      ).rejects.toThrow('应用 ABI 不允许修改')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          ...base,
          advancedSettings: { profileId: 'pixel_9', ramMiB: 4096 }
        })
      ).rejects.toThrow('非法字段（profileId）')
    })

    it('指纹不一致拒绝（外部改 config 或状态更新）', async () => {
      const { handlerFor } = await freshDomain()
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: 'stale',
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('已发生变化')
    })

    it('运行中拒绝保存（状态守卫先于指纹复验）', async () => {
      const { handlerFor } = await freshDomain()
      startThroughPreflight()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: 'any',
          name: '新名'
        })
      ).rejects.toThrow('请先停止模拟器后再保存')
    })

    it('未改表单也保存同步偏差；只改名同时同步，其他键保持', async () => {
      const raw = CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M') + 'unknown.keep=yes\n'
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        name: '新名'
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(raw.replace('228M', '256'))
      expect(mocks.fileMetas.current![0]).toMatchObject({ name: '新名', snapshotReadyAt: null })
    })

    it('采用文件 heap 后同步元数据，保留 228M 原文并清除差异', async () => {
      const raw = CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M')
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const snap = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { fingerprint: string; configMismatches: Array<{ actualSettings: unknown }> }
      expect(snap.configMismatches).toHaveLength(1)
      expect(snap.configMismatches[0].actualSettings).toEqual({ vmHeapMiB: 228 })
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint: snap.fingerprint,
        advancedSettings: { vmHeapMiB: 228 }
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(raw)
      expect(mocks.fileMetas.current![0].advancedSettings!.vmHeapMiB).toBe(228)
      const again = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { configMismatches: unknown[] }
      expect(again.configMismatches).toEqual([])
    })

    it('部分采用 heap、其余 RAM 按表单同步；等价单位不触发无操作保存', async () => {
      const raw = CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M').replace(
        'hw.ramSize=2048',
        'hw.ramSize=4096'
      )
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { vmHeapMiB: 228 }
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(
        raw.replace('hw.ramSize=4096', 'hw.ramSize=2048')
      )
    })

    it('待同步字段仍校验能力和 RAM/heap 联动，不能以未改输入绕过', async () => {
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M')
      )
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({ advancedSettings: editSettings({ vmHeapMiB: 1200 }) }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), { id: DEVICE_ID, fingerprint })
      ).rejects.toThrow('VM heap')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
      expect(mocks.writeJournal).not.toHaveBeenCalled()
    })

    it('有偏差时外部再改文件仍拒绝，不覆盖第三种内容', async () => {
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M')
      )
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=240M')
      )
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), { id: DEVICE_ID, fingerprint })
      ).rejects.toThrow('设备配置或状态已发生变化')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('编辑前后摄像头为虚拟场景：事务写入小写，其他配置保持', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: {
          frontCamera: { mode: 'virtualScene', deviceId: null },
          rearCamera: { mode: 'virtualScene', deviceId: null }
        }
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(
        CONFIG_RAW.replace('hw.camera.front=emulated', 'hw.camera.front=virtualscene').replace(
          'hw.camera.back=emulated',
          'hw.camera.back=virtualscene'
        )
      )
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0].advancedSettings?.frontCamera.mode).toBe('virtualScene')
      expect(persisted[0].advancedSettings?.rearCamera.mode).toBe('virtualScene')
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
    })

    it('历史 virtualScene 被报告为不可采用；未改表单保存也修正两槽且保留其他配置', async () => {
      const scene = { mode: 'virtualScene', deviceId: null }
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({
          advancedSettings: editSettings({ frontCamera: scene, rearCamera: scene })
        }) as never
      ])
      const raw = `${CONFIG_RAW.replace(
        'hw.camera.front=emulated',
        'hw.camera.front=virtualScene'
      ).replace('hw.camera.back=emulated', 'hw.camera.back=virtualScene')}unknown=keep\n`
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as {
        fingerprint: string
        configMismatches: Array<{ field: string; actualSettings: unknown }>
      }
      expect(snapshot.configMismatches).toEqual([
        { field: 'frontCamera', actualLabel: 'virtualScene', actualSettings: null },
        { field: 'rearCamera', actualLabel: 'virtualScene', actualSettings: null }
      ])
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint: snapshot.fingerprint
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(
        raw.replaceAll('virtualScene', 'virtualscene')
      )
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0].advancedSettings?.frontCamera).toEqual(scene)
      expect(persisted[0].advancedSettings?.rearCamera).toEqual(scene)
      expect(persisted[0].snapshotReadyAt).toBeNull()
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
    })

    it('无差异载荷：幂等返回，不写任何文件', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint
      })
      expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
      expect(mocks.writeJournal).not.toHaveBeenCalled()
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('只改名：走元数据提交，不动 config 与快照标记', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        name: '  新名字  '
      })
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0]!.name).toBe('新名字')
      expect(persisted[0]!.snapshotReadyAt).toBe(999)
      expect(mocks.writeJournal).not.toHaveBeenCalled()
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('RAM 变化：journal→config→元数据事务落盘；存储键不被改写；快照失效', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      const result = (await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { ramMiB: 4096 }
      })) as { devices: Array<{ advancedSettings: { ramMiB: number } | null }> }
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
      const written = mocks.writeAvdConfigRaw.mock.calls[0]![2] as string
      expect(written).toContain('hw.ramSize=4096')
      expect(written).toContain('disk.dataPartition.size=6144M')
      expect(written).not.toContain('disk.dataPartition.size=8')
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0]!.advancedSettings!.ramMiB).toBe(4096)
      expect(persisted[0]!.snapshotReadyAt).toBeNull()
      expect(mocks.removeJournal).toHaveBeenCalledTimes(1)
      expect(result.devices[0]!.advancedSettings!.ramMiB).toBe(4096)
    })

    it('网络字段变化（无 config 键）：快照标记保留，config 原样写回', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { networkSpeed: 'lte' }
      })
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0]!.advancedSettings!.networkSpeed).toBe('lte')
      expect(persisted[0]!.snapshotReadyAt).toBe(999)
      expect(mocks.writeAvdConfigRaw.mock.calls[0]![2]).toBe(CONFIG_RAW)
    })

    it('元数据写失败：恢复原 config 并清理记录', async () => {
      mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('盘满'))
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('盘满')
      const writes = mocks.writeAvdConfigRaw.mock.calls.map((call) => call[2])
      expect(writes[0]).toContain('hw.ramSize=4096')
      expect(writes[1]).toBe(CONFIG_RAW)
      expect(mocks.removeJournal).toHaveBeenCalledTimes(1)
    })

    it('回滚失败：冻结目标——后续保存拒绝，行内带 config-transaction 错误', async () => {
      mocks.writeDeviceMetas.mockRejectedValue(new Error('盘满'))
      let writeCount = 0
      mocks.writeAvdConfigRaw.mockImplementation(async () => {
        writeCount += 1
        if (writeCount > 1) throw new Error('回滚也失败')
      })
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('冻结')
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ lastError?: { code: string } }>
      }
      expect(list.devices[0]!.lastError?.code).toBe('config-transaction')
      const fingerprint2 = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { fingerprint: string; saveBlockedReason: string | null }
      expect(fingerprint2.saveBlockedReason).toContain('冻结')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fingerprint2.fingerprint,
          name: '再试'
        })
      ).rejects.toThrow('冻结')
    })

    it('复查 P2-3：共绑摄像头不再阻断保存；草稿提示同时运行回退语义（只改 RAM 可过）', async () => {
      // 目标自身占 webcam0；另一台设备也占 webcam0（同宿主身份），另占 webcam1
      mocks.listWebcams.mockResolvedValue([
        { id: 'webcam0', deviceLabel: 'FaceTime HD' },
        { id: 'webcam1', deviceLabel: '外接相机' }
      ])
      const occupiedDevice = editDevice({
        id: OTHER_ID,
        name: '占用机',
        advancedSettings: editSettings({
          frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' }
        })
      })
      const selfWebcam = editDevice({
        advancedSettings: editSettings({
          frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' }
        })
      })
      mocks.readDeviceMetas.mockResolvedValue([selfWebcam as never, occupiedDevice as never])
      const { handlerFor } = await freshDomain()
      // 草稿：共享的前置摄像头带非阻断提示（说明回退语义，不阻断保存）
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { fieldNotes: Record<string, { warning: string | null }>; fingerprint: string }
      expect(snapshot.fieldNotes.frontCamera?.warning).toContain('同时绑定在设备「占用机」')
      expect(snapshot.fieldNotes.rearCamera?.warning).toBeNull()
      // 想选另一台设备已占的 webcam1：设计决定后允许保存（启动时仲裁裁决）
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: snapshot.fingerprint,
          advancedSettings: { rearCamera: { mode: 'webcam', deviceId: 'webcam1' } }
        })
      ).resolves.toBeTruthy()
      // 自身已占 webcam0 未变更：只改 RAM 不误判
      const fp2 = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp2,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
    })

    it('stale webcam 未修改不阻断 RAM 编辑；新选择失效摄像头仍拒绝', async () => {
      // 相机与配置一致时仍保留旧资源；本轮只显式同步有偏差的字段。
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('hw.camera.front=emulated', 'hw.camera.front=webcam9')
      )
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({
          advancedSettings: editSettings({
            frontCamera: { mode: 'webcam', deviceId: 'webcam9' }
          })
        }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      expect(mocks.writeDeviceMetas.mock.calls.at(-1)![0][0].advancedSettings?.frontCamera).toEqual(
        { mode: 'webcam', deviceId: 'webcam9' }
      )
      const nextFp = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: nextFp,
          advancedSettings: { rearCamera: { mode: 'webcam', deviceId: 'webcam9' } }
        })
      ).rejects.toThrow('已不可用')
    })

    it('相机偏差即使表单未改，保存仍复验资源；失效时不写配置', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({
          advancedSettings: editSettings({
            frontCamera: { mode: 'webcam', deviceId: 'webcam9' }
          })
        }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint
        })
      ).rejects.toThrow('已不可用')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
      expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
    })

    it('未知 legacy 草稿不填默认容量，拒绝附加编辑但允许改名', async () => {
      mocks.readDeviceMetas.mockResolvedValue([editDevice({ advancedSettings: null }) as never])
      mocks.readAvdConfigRaw.mockResolvedValue('hw.cpu.ncore=0\n')
      const { handlerFor } = await freshDomain()
      const snap = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { settings: unknown; internalStorage: { valueMiB: unknown }; fingerprint: string }
      expect(snap.settings).toBeNull()
      expect(snap.internalStorage.valueMiB).toBeNull()
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: snap.fingerprint,
          advancedSettings: { networkSpeed: 'lte' }
        })
      ).rejects.toThrow('仅支持修改名称')
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint: snap.fingerprint,
        name: '旧机改名'
      })
      expect(mocks.writeDeviceMetas.mock.calls.at(-1)![0][0].advancedSettings).toBeNull()
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('legacy 仅改网络仍保持 GPU host，原 config auto 不被重写', async () => {
      mocks.readDeviceMetas.mockResolvedValue([editDevice({ advancedSettings: null }) as never])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { networkSpeed: 'lte' }
      })
      const saved = mocks.writeDeviceMetas.mock.calls.at(-1)![0][0].advancedSettings!
      expect(saved.graphics).toBe('host')
      const { settingsToRunnerArgs } = await import('@shared/settings-contract')
      expect(settingsToRunnerArgs(saved)).toEqual(
        expect.arrayContaining(['-gpu', 'host', '-netspeed', 'lte'])
      )
      expect(mocks.writeAvdConfigRaw.mock.calls.at(-1)![2]).toBe(CONFIG_RAW)
    })

    it('提交成功后清理失败仍成功广播；旧 journal 未清理前不得覆盖', async () => {
      mocks.removeJournal.mockRejectedValue(new Error('清理失败'))
      const send = vi.fn()
      mocks.getAllWindows.mockReturnValue([{ webContents: { send } }])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      expect(send).toHaveBeenCalledWith(
        IPC_CHANNELS.devicesChanged,
        expect.objectContaining({
          devices: expect.arrayContaining([
            expect.objectContaining({ advancedSettings: expect.objectContaining({ ramMiB: 4096 }) })
          ])
        })
      )
      mocks.readAvdConfigRaw.mockResolvedValue(CONFIG_RAW.replace('2048', '4096'))
      const nextFp = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: nextFp,
          advancedSettings: { ramMiB: 8192 }
        })
      ).rejects.toThrow('清理失败')
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
    })

    it('复查 P2-2：清理失败的残留记录在仅改名前重试清理，改名成功落盘', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      // 第一次保存成功但 journal 清理失败（一次性失败，重试可成功）
      mocks.removeJournal.mockRejectedValueOnce(new Error('清理失败'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      const cleanupCalls = mocks.removeJournal.mock.calls.length
      // 仅改名（走 commitMetas）：先重试清理成功，改名落盘
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
          id: DEVICE_ID,
          name: '清理后改名'
        })
      ).resolves.toBeTruthy()
      expect(mocks.removeJournal.mock.calls.length).toBeGreaterThan(cleanupCalls)
      expect(mocks.fileMetas.current![0]).toMatchObject({ id: DEVICE_ID, name: '清理后改名' })
    })

    it('复查 P2-2：清理持续失败时仅改名被中止，devices.json 不变（重启不误冻结）', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      mocks.removeJournal.mockRejectedValue(new Error('清理失败'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
          id: DEVICE_ID,
          name: '不该成功'
        })
      ).rejects.toThrow('未清理的配置事务记录')
      expect(mocks.fileMetas.current![0]).toMatchObject({ id: DEVICE_ID, name: '编辑机' })
    })

    it('保存前即时健康异常拒绝写入，旧扫描 valid 不能绕过', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      mocks.checkDeviceHealth.mockResolvedValue({
        state: 'unsafe',
        issues: [{ component: 'avd', code: 'symlink', severity: 'error', message: '目录已被替换' }],
        checkedAt: 1
      })
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('目录已被替换')
      expect(mocks.writeJournal).not.toHaveBeenCalled()
    })

    it('复查设计决定：跨设备编辑与创建可共绑同一摄像头；提交失败不残留阻断', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice() as never,
        editDevice({ id: OTHER_ID }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fp1 = await fingerprintOfSnapshot(handlerFor)
      mocks.wizardContext.current = { kind: 'edit', deviceId: OTHER_ID }
      const snap2 = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: OTHER_ID
      })) as { fingerprint: string }
      mocks.wizardContext.current = { kind: 'edit', deviceId: DEVICE_ID }
      // 两台设备先后选择同一摄像头：均保存成功（启动仲裁才裁决占用）
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp1,
          advancedSettings: { frontCamera: { mode: 'webcam', deviceId: 'webcam0' } }
        })
      ).resolves.toBeTruthy()
      mocks.wizardContext.current = { kind: 'edit', deviceId: OTHER_ID }
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: OTHER_ID,
          fingerprint: snap2.fingerprint,
          advancedSettings: { frontCamera: { mode: 'webcam', deviceId: 'webcam0' } }
        })
      ).resolves.toBeTruthy()
      mocks.wizardContext.current = { kind: 'edit', deviceId: DEVICE_ID }
      // 创建同样可共绑
      await expect(
        handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), {
          ...validCreateInput,
          advancedSettings: editSettings({ frontCamera: { mode: 'webcam', deviceId: 'webcam0' } })
        })
      ).resolves.toBeTruthy()
      // 提交失败（盘满）后重试成功——没有残留的预留阻断
      const fp2 = await fingerprintOfSnapshot(handlerFor)
      mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('盘满'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp2,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('盘满')
      const fp3 = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp3,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
    })

    it('明确挖孔恢复只记录目标请求，下次启动成功后才清除；普通启动不修改用户挖孔', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        resetDisplayCutout: true
      })
      expect(mocks.writeDeviceMetas.mock.calls.at(-1)![0][0]).toMatchObject({
        cutoutResetPending: true,
        snapshotReadyAt: null
      })
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
      expect(mocks.resetDisplayCutout).not.toHaveBeenCalled()
      startThroughPreflight()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      const args = mocks.createRunner.mock.calls.at(-1)![0] as {
        afterBoot: (id: string, runId: string, serial: string, signal: AbortSignal) => Promise<void>
      }
      const runId = 'run-1' // startThroughPreflight 返回的实际启动代次
      mocks.resetDisplayCutout.mockRejectedValueOnce(new Error('重启失败'))
      await expect(
        args.afterBoot(DEVICE_ID, runId, 'emulator-5556', new AbortController().signal)
      ).rejects.toThrow('重启失败')
      expect(mocks.fileMetas.current![0].cutoutResetPending).toBe(true)
      await args.afterBoot(DEVICE_ID, runId, 'emulator-5556', new AbortController().signal)
      expect(mocks.fileMetas.current![0].cutoutResetPending).toBeUndefined()
      const count = mocks.resetDisplayCutout.mock.calls.length
      await args.afterBoot(DEVICE_ID, runId, 'emulator-5556', new AbortController().signal)
      expect(mocks.resetDisplayCutout).toHaveBeenCalledTimes(count)
    })

    it('编辑窗不能发起创建（create/edit 隔离）', async () => {
      const { handlerFor } = await freshDomain()
      await expect(
        handlerFor(IPC_CHANNELS.devicesCreate)(editEvent(), validCreateInput)
      ).rejects.toThrow('未登记的窗口')
    })

    it('保存进行中：启动/删除/独立重命名拒绝同设备交错', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      let releaseConfigRead!: (value: string | null) => void
      let hang = true
      mocks.readAvdConfigRaw.mockImplementation(async () => {
        if (!hang) return CONFIG_RAW
        return await new Promise<string | null>((resolve) => {
          releaseConfigRead = resolve
        })
      })
      const saving = handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        name: '改名'
      })
      await vi.waitFor(() => expect(typeof releaseConfigRead).toBe('function'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('正在保存配置')
      await expect(
        handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('正在保存配置')
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), { id: DEVICE_ID, name: '别改' })
      ).rejects.toThrow('正在保存配置')
      hang = false
      releaseConfigRead(CONFIG_RAW)
      await expect(saving).resolves.toBeTruthy()
    })
  })

  describe('摄像头启动仲裁（设计决定 2026-10-09）', () => {
    const EARLY_ID = '018f1c2d-aaaa-4000-8000-000000000001'
    const LATE_ID = '018f1c2d-bbbb-4000-8000-000000000002'
    const configWithCamera = (front: string): string =>
      [
        'avd.ini.encoding=UTF-8',
        'hw.ramSize=2048',
        'hw.cpu.ncore=4',
        'vm.heapSize=256',
        'hw.gpu.mode=auto',
        `hw.camera.front=${front}`,
        'hw.camera.back=emulated',
        'disk.dataPartition.size=6144M',
        ''
      ].join('\n')

    const deviceMeta = (
      id: string,
      name: string,
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> => ({
      id,
      name,
      profileId: 'pixel_8',
      profileLabel: 'Pixel 8',
      imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      apiDisplay: '36',
      formFactor: 'phone',
      screenSummary: null,
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' },
        rearCamera: { mode: 'emulated', deviceId: null },
        networkSpeed: null,
        networkLatency: null,
        orientation: null,
        bootMode: 'cold',
        internalStorageMiB: 6144,
        cpuCores: 4,
        graphics: 'auto',
        ramMiB: 2048,
        vmHeapMiB: 256,
        preferredAbi: 'optimal'
      },
      snapshotReadyAt: null,
      createdAt: 0,
      ...overrides
    })

    /** runner 配置接缝：extraArgsFor 在 spawn 时被调用 */
    const extraArgsFor = (id: string): string[] => {
      const config = mocks.createRunner.mock.calls.at(-1)![0] as {
        extraArgsFor?: (id: string) => string[]
      }
      return config.extraArgsFor?.(id) ?? []
    }

    /** 驱动 beforeStart 并回显传入 runId：仲裁覆盖按 runId 隔离，行内代次要一致 */
    const startEchoingRunId = (): void => {
      mocks.runnerInstance.start.mockImplementation(
        async (id: string, runId: string): Promise<{ runId: string; serial: string }> => {
          const config = mocks.createRunner.mock.calls.at(-1)![0] as {
            beforeStart?: (id: string, runId: string, signal: AbortSignal) => Promise<void>
          }
          await config.beforeStart?.(id, runId, new AbortController().signal)
          return { runId, serial: 'emulator-5554' }
        }
      )
    }

    /** 行内当前 runId（回显后 = 启动代次） */
    const runIdOf = async (
      handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>,
      id: string
    ): Promise<string | undefined> => {
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; runId?: string }>
      }
      return list.devices.find((device) => device.id === id)?.runId
    }

    beforeEach(() => {
      vi.clearAllMocks()
      mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
      mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
        mocks.fileMetas.current = metas
      })
      mocks.getAllWindows.mockReturnValue([])
      mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
      mocks.writeAvdConfigRaw.mockResolvedValue(undefined)
      mocks.readHardwareSchemaDefaults.mockResolvedValue({})
      mocks.recoverPendingTransactions.mockResolvedValue({
        completed: [],
        rolledBack: [],
        frozen: []
      })
      mocks.listWebcams.mockResolvedValue([{ id: 'webcam0', deviceLabel: 'FaceTime HD' }])
      mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
      mocks.runnerInstance.stop.mockResolvedValue(undefined)
      startEchoingRunId()
    })

    it('先到先得：运行中的先启动方保住摄像头，后启动方回退模拟画面并透出行内通知', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机') as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async (name: string) =>
        name === EARLY_ID ? configWithCamera('webcam0') : configWithCamera('webcam0')
      )
      const { handlerFor, runnerEvents } = await freshDomain()
      // 先启机启动并进入运行
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      // 后启机启动：仲裁命中同一宿主摄像头
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).toEqual(expect.arrayContaining(['-camera-front', 'emulated']))
      expect(extraArgsFor(EARLY_ID)).not.toContain('emulated')
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; cameraNotice?: string }>
      }
      const late = list.devices.find((device) => device.id === LATE_ID)
      const early = list.devices.find((device) => device.id === EARLY_ID)
      expect(late?.cameraNotice).toContain('前置摄像头')
      expect(late?.cameraNotice).toContain('先启机')
      expect(late?.cameraNotice).toContain('模拟画面')
      expect(early?.cameraNotice).toBeUndefined()
    })

    it('托管设置的既有 -camera-front 参数被替换为 emulated（不改 config.ini）', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机') as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam0'))
      // 与真实契约一致：托管设置会输出 -camera-front webcam0（once——不泄漏到后续用例）
      mocks.settingsToRunnerArgs.mockImplementationOnce(() => [
        '-camera-front',
        'webcam0',
        '-no-snapshot',
        '-gpu',
        'host'
      ])
      const { handlerFor, runnerEvents } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      const args = extraArgsFor(LATE_ID)
      const flagIndex = args.indexOf('-camera-front')
      expect(flagIndex).toBeGreaterThanOrEqual(0)
      expect(args[flagIndex + 1]).toBe('emulated')
      expect(args).not.toContain('webcam0')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('legacy 设备同样参与仲裁：无既有 camera 参数时追加回退参数', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机', { advancedSettings: null }) as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam0'))
      const { handlerFor, runnerEvents } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).toEqual(expect.arrayContaining(['-camera-front', 'emulated']))
      // legacy 设备的 config.ini 绑定是仲裁数据源（复查 P2-3：旧设备绑定计入）
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; cameraNotice?: string }>
      }
      expect(list.devices.find((device) => device.id === LATE_ID)?.cameraNotice).toContain(
        '模拟画面'
      )
    })

    it('legacy 死绑定：枚举成功但资源号已消失 → 回退模拟画面并说明', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(LATE_ID, '旧绑定机', { advancedSettings: null }) as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam9'))
      const { handlerFor } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).toEqual(expect.arrayContaining(['-camera-front', 'emulated']))
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ cameraNotice?: string }>
      }
      expect(list.devices[0]?.cameraNotice).toContain('webcam9')
      expect(list.devices[0]?.cameraNotice).toContain('已不可用')
    })

    it('对端停止后重启：恢复真实摄像头，通知清除', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机') as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam0'))
      const { handlerFor, runnerEvents } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      runnerEvents().onRunning(LATE_ID, (await runIdOf(handlerFor, LATE_ID))!, 'emulator-5556')
      expect(extraArgsFor(LATE_ID)).toContain('emulated')
      // 两台都停止后重启后启机：无占用，真实摄像头恢复
      await handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), { id: LATE_ID })
      await handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), { id: EARLY_ID })
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).not.toContain('emulated')
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; cameraNotice?: string }>
      }
      expect(list.devices.find((device) => device.id === LATE_ID)?.cameraNotice).toBeUndefined()
    })
  })

  describe('首载恢复（冻结目标落到行内）', () => {
    it('恢复冻结的设备：lastError= config-transaction 且保存被拒', async () => {
      mocks.recoverPendingTransactions.mockResolvedValue({
        completed: [],
        rolledBack: [],
        frozen: [{ deviceId: DEVICE_ID, message: '上次保存未完成，已冻结' }]
      })
      const { handlerFor } = await freshDomain()
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ lastError?: { code: string; message: string } }>
      }
      expect(list.devices[0]!.lastError?.code).toBe('config-transaction')
      expect(list.devices[0]!.lastError?.message).toBe('上次保存未完成，已冻结')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: 'fp',
          name: '改名'
        })
      ).rejects.toThrow('已冻结')
    })
  })
})

describe('皮肤只装饰外观，不能覆盖机型屏幕尺寸', () => {
  const skinConfig = 'skin.path=/skins/pixel_7\nskin.name=pixel_7\n'
  const runnerConfig = (): {
    beforeStart: (id: string, runId: string, signal: AbortSignal) => Promise<void>
    extraArgsFor: (id: string) => string[]
  } => mocks.createRunner.mock.calls.at(-1)![0] as never

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readDeviceMetas.mockResolvedValue([quickDevice({ advancedSettings: null }) as never])
    mocks.readAvdConfigRaw.mockResolvedValue(null)
    mocks.recoverPendingTransactions.mockResolvedValue({
      completed: [],
      rolledBack: [],
      frozen: []
    })
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.storeHealth.mockReturnValue({ state: 'ok', issues: [] })
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.runnerInstance.start.mockImplementation(async (id: string, runId: string) => {
      await runnerConfig().beforeStart(id, runId, new AbortController().signal)
      return { runId, serial: 'emulator-5556' }
    })
    mocks.runnerInstance.cancelStart.mockResolvedValue(undefined)
  })

  it('QVGA 配了大屏皮肤，启动仍指定 240x320；原运行参数和落盘配置不变', async () => {
    mocks.readAvdConfigRaw.mockResolvedValue(
      `${skinConfig}hw.lcd.width=240\nhw.lcd.height=320\nhw.lcd.density=120\n`
    )
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual([
      '-no-snapshot',
      '-gpu',
      'host',
      '-skin',
      '240x320'
    ])
    expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    expect(mocks.patchAvdConfig).not.toHaveBeenCalled()
    expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
  })

  it('附加屏幕参数保留 Quick 首启策略，不把 GPU 或快照策略改成 legacy 默认值', async () => {
    mocks.readDeviceMetas.mockResolvedValue([quickDevice() as never])
    mocks.readAvdConfigRaw.mockResolvedValue(`${skinConfig}hw.lcd.width=1080\nhw.lcd.height=2400\n`)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual([
      '-no-snapshot-load',
      '-skin',
      '1080x2400'
    ])
  })

  it.each([
    null,
    skinConfig,
    `${skinConfig}hw.lcd.width=0\nhw.lcd.height=320\n`,
    `${skinConfig}hw.lcd.width=240x1080\nhw.lcd.height=320\n`,
    'hw.lcd.width=240\nhw.lcd.height=320\n'
  ])('无皮肤或无有效尺寸不猜测分辨率，保持原启动参数（%s）', async (raw) => {
    mocks.readAvdConfigRaw.mockResolvedValue(raw)
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual(['-no-snapshot', '-gpu', 'host'])
  })

  it('取消后再次启动重读配置，不复用上一代次的屏幕参数', async () => {
    mocks.readAvdConfigRaw
      .mockResolvedValueOnce(`${skinConfig}hw.lcd.width=240\nhw.lcd.height=320\n`)
      .mockResolvedValueOnce('hw.lcd.width=240\nhw.lcd.height=320\n')
    const { handlerFor } = await freshDomain()
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toContain('240x320')
    await handlerFor(IPC_CHANNELS.devicesCancelStart)(mainWindowEvent(), { id: 'quick-1' })
    await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    expect(runnerConfig().extraArgsFor('quick-1')).toEqual(['-no-snapshot', '-gpu', 'host'])
    expect(mocks.readAvdConfigRaw).toHaveBeenCalledTimes(2)
  })

  it('读取配置失败时启动失败，不带着未经检查的皮肤继续启动', async () => {
    // 一次性拒绝：mockRejectedValue 会渗入后续 describe（clearAllMocks 不清实现，
    // issue 2026-10-10-devices-test-mock-leak），Once 用完即回底层缺省实现
    mocks.readAvdConfigRaw.mockRejectedValueOnce(new Error('AVD config.ini 读取失败'))
    const { handlerFor } = await freshDomain()
    await expect(
      handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: 'quick-1' })
    ).rejects.toThrow('AVD config.ini 读取失败')
    expect(runnerConfig().extraArgsFor('quick-1')).not.toContain('-skin')
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
