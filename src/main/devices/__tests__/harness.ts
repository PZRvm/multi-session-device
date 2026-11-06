/** devices 域测试共享 harness：mock 前导（18 个 vi.mock）+ freshDomain 动态导入助手。
 *  每个测试文件静态导入本模块——mock 注册先于 freshDomain 内的动态 import('..')。
 *  describe 自带的 beforeEach（clearAllMocks + 重新播种）保持原语义。 */
import { vi } from 'vitest'
import type { DeviceAvailability, DeviceMeta } from '@shared/types'

type MainWindow = {
  webContents: { id: number; send: (channel: string, payload: unknown) => void }
}

/** 全部 mock 的单点持有（原 vi.hoisted 块展开为普通对象：工厂惰性执行，无需 hoisted；
 *  vitest 不允许导出 hoisted 变量） */
export const mocks = {
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
  // adb 命令应答（readGuestBootId 等）：默认返回稳定 boot_id
  runAdb: vi.fn(async () => ({ code: 0, stdout: 'boot-id-stable\n', stderr: '' })),
  // 休眠 console：默认受理成功
  emuConsoleExec: vi.fn(async () => ''),
  // 休眠清单内存态：read/write/remove/snapshotExists 围绕本 map（'corrupt' = 模拟损坏）
  hibernationStore: {
    current: new Map<
      string,
      | {
          schemaVersion: 1
          deviceId: string
          snapshotName: string
          savedAt: number
          guestBootId: string
          stage: 'saving' | 'saved' | 'hibernated'
          emulatorVersion: string | null
          imagePackageName: string
          imageRevision: number | null
          gpuBackend: string
          hardwareFingerprint: string
        }
      | 'corrupt'
    >()
  },
  waitHibernationSnapshotStable: vi.fn(async () => 1024),
  cleanupOldHibernationSnapshots: vi.fn(async () => undefined),
  tcpProbe: vi.fn(async () => false),
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
    quit: vi.fn(async () => undefined),
    phaseOf: vi.fn((): 'starting' | 'running' | 'stopping' | null => null),
    serialOf: vi.fn((): string | undefined => undefined),
    portOf: vi.fn((): number | undefined => 5554),
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

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.getAllWindows, fromWebContents: vi.fn(() => null) },
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
  resolveAdbExecutable: mocks.resolveAdbExecutable,
  runAdb: mocks.runAdb
}))
vi.mock('../../emulator/emuConsole', () => ({ emuConsoleExec: mocks.emuConsoleExec }))
// 休眠清单域：IO 点换内存态（原子写语义由 hibernation 模块单测覆盖）
vi.mock('../../emulator/hibernation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../emulator/hibernation')>()
  return {
    ...actual,
    readHibernationManifest: async (deviceId: string) => {
      const entry = mocks.hibernationStore.current.get(deviceId)
      if (entry === undefined) return { kind: 'none' } as const
      if (entry === 'corrupt') return { kind: 'corrupt', reason: 'simulated' } as const
      return { kind: 'ok', manifest: entry } as const
    },
    writeHibernationManifest: async (_deviceId: string, manifest: unknown) => {
      const record = manifest as {
        deviceId: string
      }
      mocks.hibernationStore.current.set(record.deviceId, manifest as never)
    },
    removeHibernationManifest: async (deviceId: string) => {
      mocks.hibernationStore.current.delete(deviceId)
    },
    hibernationSnapshotExists: async (deviceId: string) => {
      const entry = mocks.hibernationStore.current.get(deviceId)
      return typeof entry === 'object' && entry !== null
    },
    waitHibernationSnapshotStable: mocks.waitHibernationSnapshotStable,
    cleanupOldHibernationSnapshots: mocks.cleanupOldHibernationSnapshots
  }
})
vi.mock('../../emulator/ports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../emulator/ports')>()),
  tcpProbe: mocks.tcpProbe
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
vi.mock('../../window/report', () => ({
  getReportWindow: () => null,
  openReportWindow: async () => {},
  closeReportWindow: () => {},
  registerReportIpc: () => {}
}))
vi.mock('../../window/wizard', () => ({
  wizardOwns: mocks.wizardOwns,
  wizardContextOf: (sender: { id?: number } | null | undefined) =>
    sender !== null && sender !== undefined && sender.id === 9 ? mocks.wizardContext.current : null
}))

/** devices 域有模块级状态——每用例 resetModules 动态导入隔离 */
export const freshDomain = async (): Promise<{
  domain: typeof import('..')
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
  mocks.hibernationStore.current.clear()
  mocks.createRunner.mockImplementation(() => mocks.runnerInstance)
  const domain = await import('..')
  domain.registerDevicesIpc()
  return {
    domain,
    handlerFor: (channel: string) => {
      // 多域测试：后注册者胜（find 会永远命中第一个域的 handler）
      const call = mocks.handle.mock.calls.findLast(([name]) => name === channel)
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

export const mainWindowEvent = (): unknown => ({ sender: { id: 7 } })
export const wizardEvent = (): unknown => ({ sender: { id: 9 } })

/** 真实链路里 runner 准备会执行 beforeStart——mock start 在此同步走一遍以驱动核验 */
export const startThroughPreflight = (): void => {
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

export const validCreateInput = {
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
  name: '测试机'
}

export const quickDevice = (
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
