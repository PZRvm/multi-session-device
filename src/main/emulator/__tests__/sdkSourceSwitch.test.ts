// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  realpath: vi.fn(async (path: string) => path)
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userdata') },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('node:fs/promises', () => fsMocks)
vi.mock('../../devices', () => ({ runningDeviceCount: vi.fn(() => 0) }))

import { resetSdkSourceStateForTest, setSdkSourceState, getSdkSourceState } from '../sdkSource'
import {
  adoptSourceSwitch,
  cancelSourceMigration,
  clearRetainedRoot,
  clearRetainedWithCascade,
  createSwitchDeps,
  onSdkSourceChanged,
  startSourceMigration,
  switchSource,
  type SwitchDeps
} from '../sdkSourceSwitch'
import {
  loadMigrationJournal,
  migrationJournalPath,
  resetMigrationFlagForTest
} from '../sdkMigration'
import { FakeFs, makeDeps } from './sdkMigration.test'
import type { StudioSdkDetection } from '@shared/types'

const MANAGED = '/userdata/AndroidSDK'
const CUSTOM = '/vol/sdk'
const AVD_HOME = '/avd-home'
const STUDIO_SDK = '/Users/t/Library/Android/sdk'

const detectionOf = (over: Partial<StudioSdkDetection> = {}): StudioSdkDetection => ({
  studioFound: true,
  studioAppPath: '/Applications/Android Studio.app',
  jbrHome: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  sdkCandidate: STUDIO_SDK,
  candidateSource: 'default-dir',
  defaultSdkPath: STUDIO_SDK,
  ...over
})

/** 广播收集（模块级；beforeEach 清空——本文件测试串行） */
const sentBroadcasts: { channel: string; payload: unknown }[] = []

const buildDeps = (fs: FakeFs, over: Partial<SwitchDeps> = {}): SwitchDeps => ({
  migration: makeDeps(fs),
  runningCount: () => 0,
  avdHome: () => AVD_HOME,
  broadcast: (channel, payload) => {
    sentBroadcasts.push({ channel, payload })
  },
  detection: () => detectionOf(),
  runDetection: async () => detectionOf(),
  ...over
})

const seedManaged = (fs: FakeFs): void => {
  fs.devs.set(MANAGED, 1)
  seedSourceInto(fs, MANAGED)
}

const seedSourceInto = (fs: FakeFs, root: string): void => {
  for (const marker of [
    'cmdline-tools/latest/bin/sdkmanager',
    'platform-tools/adb',
    'emulator/emulator',
    'jre/Contents/Home/bin/java',
    'licenses/android-sdk-license'
  ]) {
    fs.write(`${root}/${marker}`, `bin:${marker}`)
  }
  fs.write(`${root}/system-images/android-34/google_apis/arm64-v8a/snapshot.img`, 'x'.repeat(500))
}

const seedAvdBoundTo = (fs: FakeFs, root: string): void => {
  fs.mkdirP(`${AVD_HOME}/d1.avd`)
  fs.write(
    `${AVD_HOME}/d1.avd/config.ini`,
    `image.sys.src.dir=${root}/system-images/android-34/google_apis/arm64-v8a\n`
  )
}

describe('switchSource（矩阵判定）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    sentBroadcasts.length = 0
    resetSdkSourceStateForTest()
  })

  it('同目标同路径 = no-change；运行会话 >0 = running-sessions', async () => {
    seedManaged(fs)
    const deps = buildDeps(fs)
    expect(await switchSource({ target: 'managed' }, deps)).toMatchObject({
      action: 'rejected',
      code: 'no-change'
    })

    const busy = buildDeps(fs, { runningCount: () => 2 })
    expect(await switchSource({ target: 'shared-studio' }, busy)).toMatchObject({
      action: 'rejected',
      code: 'running-sessions'
    })
  })

  it('journal 在场 = journal-pending（崩溃恢复横幅引导）', async () => {
    seedManaged(fs)
    fs.write(
      '/userdata/sdk-migration.json',
      '{"version":1,"fromRoot":"/a","toRoot":"/b","targetSource":"custom","targetCleared":false,"entries":[],"phase":"moving","movedBytes":0,"totalBytes":0}'
    )
    expect(
      await switchSource({ target: 'custom', customPath: CUSTOM }, buildDeps(fs))
    ).toMatchObject({
      action: 'rejected',
      code: 'journal-pending'
    })
  })

  it('共享切换：Studio 未装 / SDK 未定位拒绝；检得则 direct 且当前根原地保留', async () => {
    seedManaged(fs)
    const noStudio = buildDeps(fs, {
      detection: () => detectionOf({ studioFound: false })
    })
    expect(await switchSource({ target: 'shared-studio' }, noStudio)).toMatchObject({
      action: 'rejected',
      code: 'studio-not-found'
    })

    const noSdk = buildDeps(fs, {
      detection: () => detectionOf({ studioFound: true, sdkCandidate: null })
    })
    expect(await switchSource({ target: 'shared-studio' }, noSdk)).toMatchObject({
      action: 'rejected',
      code: 'studio-sdk-not-located'
    })

    const result = await switchSource({ target: 'shared-studio' }, buildDeps(fs))
    expect(result.action).toBe('direct')
    expect(getSdkSourceState().source).toBe('shared-studio')
    expect(getSdkSourceState().sharedPath).toBe(STUDIO_SDK)
    // 共享永不迁移：托管根原样保留
    expect(fs.exists(`${MANAGED}/platform-tools/adb`)).toBe(true)
  })

  it('自选目标：缺路径 / 手选了 Studio SDK / 目标杂物 分别拒绝', async () => {
    seedManaged(fs)
    expect(await switchSource({ target: 'custom' }, buildDeps(fs))).toMatchObject({
      action: 'rejected',
      code: 'custom-path-required'
    })
    expect(
      await switchSource({ target: 'custom', customPath: STUDIO_SDK }, buildDeps(fs))
    ).toMatchObject({ action: 'rejected', code: 'studio-path-use-shared' })
    fs.write(`${CUSTOM}/random.txt`, 'junk')
    expect(
      await switchSource({ target: 'custom', customPath: CUSTOM }, buildDeps(fs))
    ).toMatchObject({ action: 'rejected', code: 'target-junk' })
  })

  it('托管 → 空自选根 = needs-migration（附体量与绑定设备数）', async () => {
    seedManaged(fs)
    seedAvdBoundTo(fs, MANAGED)
    fs.devs.set(CUSTOM, 2)
    const result = await switchSource({ target: 'custom', customPath: CUSTOM }, buildDeps(fs))
    expect(result).toMatchObject({
      action: 'needs-migration',
      fromRoot: MANAGED,
      toRoot: CUSTOM,
      boundDevices: 1
    })
    if (result.action === 'needs-migration') expect(result.bytes).toBeGreaterThan(500)
    // 判定不改状态
    expect(getSdkSourceState().source).toBe('managed')
  })

  it('目标已有 SDK 且有落选内容 = needs-choice；无落选内容（从共享切回）= direct 沿用', async () => {
    seedManaged(fs)
    fs.devs.set(CUSTOM, 1)
    seedSourceInto(fs, CUSTOM)
    seedAvdBoundTo(fs, MANAGED)
    const choice = await switchSource({ target: 'custom', customPath: CUSTOM }, buildDeps(fs))
    expect(choice).toMatchObject({
      action: 'needs-choice',
      targetRoot: CUSTOM,
      loserRoot: MANAGED,
      loserBoundDevices: 1
    })

    // 共享态（custom 无内容）：managed 是保留根、无其他落选 → 切回 direct 沿用
    resetSdkSourceStateForTest()
    setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: '/vol/empty-custom',
      sharedPath: STUDIO_SDK
    })
    const direct = await switchSource({ target: 'managed' }, buildDeps(fs))
    expect(direct.action).toBe('direct')
    expect(getSdkSourceState().source).toBe('managed')
    expect(fs.exists(`${MANAGED}/platform-tools/adb`)).toBe(true)
  })

  it('处处皆空 → direct 空根起步（source 翻、无迁移）', async () => {
    fs.devs.set(CUSTOM, 1)
    const result = await switchSource({ target: 'custom', customPath: CUSTOM }, buildDeps(fs))
    expect(result.action).toBe('direct')
    expect(getSdkSourceState().source).toBe('custom')
    expect(getSdkSourceState().customPath).toBe(CUSTOM)
  })
})

describe('adoptSourceSwitch（直接使用）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    sentBroadcasts.length = 0
    resetSdkSourceStateForTest()
  })

  it('翻 source + relink 落选根绑定 + 删除落选根', async () => {
    seedSourceInto(fs, MANAGED)
    seedSourceInto(fs, `${CUSTOM}/system-images/android-34/google_apis/arm64-v8a`)
    fs.write(
      `${CUSTOM}/system-images/android-34/google_apis/arm64-v8a/snapshot.img`,
      'x'.repeat(500)
    )
    // CUSTOM 是完整 SDK（除 system-images 外还需要可识别标记）
    fs.write(`${CUSTOM}/platform-tools/adb`, 'bin')
    seedAvdBoundTo(fs, MANAGED)
    fs.devs.set(CUSTOM, 1)
    const snapshot = await adoptSourceSwitch(
      { target: 'custom', customPath: CUSTOM },
      buildDeps(fs)
    )
    expect(snapshot.source).toBe('custom')
    expect(fs.exists(MANAGED)).toBe(false)
    expect(fs.exists(`${CUSTOM}/platform-tools/adb`)).toBe(true)
    expect(fs.read(`${AVD_HOME}/d1.avd/config.ini`)).toContain(`image.sys.src.dir=${CUSTOM}/`)
  })

  it('目标无可识别 SDK 拒绝', async () => {
    await expect(
      adoptSourceSwitch({ target: 'custom', customPath: '/nowhere' }, buildDeps(fs))
    ).rejects.toThrow('recognizable')
  })
})

describe('clearRetainedRoot（仅共享模式）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    sentBroadcasts.length = 0
    resetSdkSourceStateForTest()
  })

  it('非共享态服务端拒绝（禁用态可被伪造入参绕过——双保险）', async () => {
    seedSourceInto(fs, MANAGED)
    await expect(clearRetainedRoot({ root: MANAGED }, buildDeps(fs))).rejects.toThrow('shared')
  })

  it('共享态可清托管根；非保留根拒绝', async () => {
    seedSourceInto(fs, MANAGED)
    setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: STUDIO_SDK
    })
    const snapshot = await clearRetainedRoot({ root: MANAGED }, buildDeps(fs))
    expect(snapshot.source).toBe('shared-studio')
    expect(fs.exists(MANAGED)).toBe(false)
    await expect(clearRetainedRoot({ root: '/other' }, buildDeps(fs))).rejects.toThrow('retained')
  })
})

describe('clearRetainedWithCascade（清除级联编排，review P2-3）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    sentBroadcasts.length = 0
    resetSdkSourceStateForTest()
    resetMigrationFlagForTest()
  })

  const sharedDeps = (): SwitchDeps => {
    seedSourceInto(fs, MANAGED)
    setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: STUDIO_SDK
    })
    return buildDeps(fs)
  }

  it('顺序：先清 SDK 后级联 purge；成功路径 failures 为空', async () => {
    const order: string[] = []
    const base = sharedDeps()
    const deps = {
      ...base,
      migration: {
        ...base.migration,
        rmTree: async (path: string) => {
          order.push(`rm:${path}`)
          return base.migration.rmTree(path)
        }
      },
      purgeAppOwnedDevices: async () => {
        order.push('purge')
        return { deleted: [{ id: 'd1', name: '自有机' }], failures: [] }
      }
    }
    const result = await clearRetainedWithCascade({ root: MANAGED }, deps)
    expect(result.snapshot.source).toBe('shared-studio')
    expect(result.failures).toEqual([])
    expect(order).toEqual([`rm:${MANAGED}`, 'purge'])
    expect(fs.exists(MANAGED)).toBe(false)
  })

  it('级联失败聚合返回不抛（SDK 已删、残留由调用方上报）', async () => {
    const base = sharedDeps()
    const deps = {
      ...base,
      purgeAppOwnedDevices: async () => ({
        deleted: [{ id: 'd1', name: 'A 机' }],
        failures: [
          { name: 'B 机', message: '删除未完成' },
          { name: 'C 机', message: '盘满' }
        ]
      })
    }
    const result = await clearRetainedWithCascade({ root: MANAGED }, deps)
    expect(result.failures.map((entry) => entry.name)).toEqual(['B 机', 'C 机'])
    // 主操作已成立：SDK 已清
    expect(fs.exists(MANAGED)).toBe(false)
  })

  it('purge 缺席：只清 SDK 不动设备（passthrough）', async () => {
    const result = await clearRetainedWithCascade({ root: MANAGED }, sharedDeps())
    expect(result.failures).toEqual([])
    expect(fs.exists(MANAGED)).toBe(false)
  })

  it('非共享态：clearRetainedRoot 守卫照常拒绝（级联不启动）', async () => {
    seedSourceInto(fs, MANAGED)
    const purge = vi.fn(async () => ({ deleted: [], failures: [] }))
    await expect(
      clearRetainedWithCascade({ root: MANAGED }, { ...buildDeps(fs), purgeAppOwnedDevices: purge })
    ).rejects.toThrow('shared')
    expect(purge).not.toHaveBeenCalled()
  })
})

describe('startSourceMigration / cancelSourceMigration（编排收尾）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    sentBroadcasts.length = 0
    resetSdkSourceStateForTest()
  })

  it('迁移成功：翻 source + 丢弃 journal + relink + 广播进度到 done', async () => {
    seedManaged(fs)
    seedAvdBoundTo(fs, MANAGED)
    fs.devs.set(CUSTOM, 1)
    const deps = buildDeps(fs)
    await startSourceMigration({ target: 'custom', customPath: CUSTOM, replace: false }, deps)
    expect(getSdkSourceState().source).toBe('custom')
    expect(getSdkSourceState().customPath).toBe(CUSTOM)
    expect(fs.exists(MANAGED)).toBe(false)
    expect(fs.exists(`${CUSTOM}/platform-tools/adb`)).toBe(true)
    expect(await loadMigrationJournal(deps.migration)).toBeNull()
    expect(fs.read(`${AVD_HOME}/d1.avd/config.ini`)).toContain(`image.sys.src.dir=${CUSTOM}/`)
    const phases = sentBroadcasts
      .filter((entry) => entry.channel === 'sdk:migrate-progress')
      .map((entry) => (entry.payload as { phase: string }).phase)
    expect(phases).toContain('moving')
    expect(phases.at(-1)).toBe('done')
    expect(sentBroadcasts.some((entry) => entry.channel === 'sdk:source-changed')).toBe(true)
  })

  it('journal 在场时 start = 崩溃恢复继续（同通道同语义）', async () => {
    seedManaged(fs)
    fs.devs.set(CUSTOM, 1)
    const deps = buildDeps(fs)
    // 伪造中断 journal：真实 journal 由全量扫描生成（六个顶层条目），platform-tools 已移
    fs.write(`${CUSTOM}/platform-tools/adb`, 'bin:platform-tools/adb')
    fs.rmTree(`${MANAGED}/platform-tools`)
    fs.write(
      migrationJournalPath(deps.migration),
      JSON.stringify({
        version: 1,
        fromRoot: MANAGED,
        toRoot: CUSTOM,
        targetSource: 'custom',
        targetCleared: false,
        entries: [
          { name: 'cmdline-tools', bytes: 40, files: 1, done: false },
          { name: 'platform-tools', bytes: 30, files: 1, done: true },
          { name: 'emulator', bytes: 30, files: 1, done: false },
          { name: 'jre', bytes: 40, files: 1, done: false },
          { name: 'licenses', bytes: 40, files: 1, done: false },
          { name: 'system-images', bytes: 500, files: 1, done: false }
        ],
        phase: 'moving',
        movedBytes: 30,
        totalBytes: 680
      })
    )
    await startSourceMigration({ target: 'custom', customPath: CUSTOM, replace: false }, deps)
    expect(getSdkSourceState().source).toBe('custom')
    expect(await loadMigrationJournal(deps.migration)).toBeNull()
    expect(fs.exists(`${CUSTOM}/emulator/emulator`)).toBe(true)
    expect(fs.exists(`${CUSTOM}/jre/Contents/Home/bin/java`)).toBe(true)
  })

  it('cancel = 回滚：journal 清除、source 保持旧值', async () => {
    seedManaged(fs)
    fs.devs.set(CUSTOM, 1)
    const deps = buildDeps(fs)
    // 直接伪造中断 journal 后走 cancel（等价在途取消后的收尾路径）
    fs.write(
      migrationJournalPath(deps.migration),
      JSON.stringify({
        version: 1,
        fromRoot: MANAGED,
        toRoot: CUSTOM,
        targetSource: 'custom',
        targetCleared: false,
        entries: [{ name: 'platform-tools', bytes: 30, files: 1, done: true }],
        phase: 'moving',
        movedBytes: 30,
        totalBytes: 30
      })
    )
    fs.write(`${CUSTOM}/platform-tools/adb`, 'bin:platform-tools/adb')
    fs.rmTree(`${MANAGED}/platform-tools`)
    await cancelSourceMigration(deps)
    expect(await loadMigrationJournal(deps.migration)).toBeNull()
    expect(getSdkSourceState().source).toBe('managed')
    expect(fs.exists(`${MANAGED}/platform-tools/adb`)).toBe(true)
  })
})
describe('伪造载荷兜底（issue 2026-10-11 问题四处置）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    resetSdkSourceStateForTest()
  })

  it('source-migrate 指向 Studio SDK：服务端拒绝，不建 journal 不动来源', async () => {
    seedManaged(fs)
    seedSourceInto(fs, STUDIO_SDK)
    const deps = buildDeps(fs)
    await expect(
      startSourceMigration({ target: 'custom', customPath: STUDIO_SDK, replace: true }, deps)
    ).rejects.toThrow('Android Studio SDK')
    expect(await loadMigrationJournal(deps.migration)).toBeNull()
    expect(getSdkSourceState().source).toBe('managed')
    expect(fs.exists(`${MANAGED}/platform-tools/adb`)).toBe(true)
  })

  it('source-adopt 指向 Studio SDK：服务端拒绝，不翻 source、不删落选根', async () => {
    seedManaged(fs)
    seedSourceInto(fs, STUDIO_SDK)
    const deps = buildDeps(fs)
    await expect(
      adoptSourceSwitch({ target: 'custom', customPath: STUDIO_SDK }, deps)
    ).rejects.toThrow('Android Studio SDK')
    expect(getSdkSourceState().source).toBe('managed')
    // 落选根（托管）原封未动——adopt 的 rmTree 未执行
    expect(fs.exists(`${MANAGED}/licenses/android-sdk-license`)).toBe(true)
    expect(fs.exists(`${MANAGED}/jre/Contents/Home/bin/java`)).toBe(true)
  })
})

describe('cancelSourceMigration on corrupt journal（问题二处置）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    resetSdkSourceStateForTest()
    resetMigrationFlagForTest()
  })

  it('journal 损坏 + 半迁移布局 → 探测式回滚：源恢复、journal 清、source 不翻', async () => {
    seedManaged(fs)
    seedAvdBoundTo(fs, MANAGED)
    fs.devs.set(CUSTOM, 1)
    fs.mkdirP(CUSTOM)
    fs.rename(`${MANAGED}/platform-tools`, `${CUSTOM}/platform-tools`)
    fs.rename(`${MANAGED}/emulator`, `${CUSTOM}/emulator`)
    // 真实半损形态：整体 JSON 坏，但 toRoot 字段片段仍可读（managed→custom
    // 半迁移时 sdk.json 还没有 customPath——方向全靠这条线索）
    fs.write(
      migrationJournalPath(makeDeps(fs)),
      `{"version":1,"fromRoot":"${MANAGED}","toRoot":"${CUSTOM}","entries":[ BROKEN`
    )
    const deps = buildDeps(fs)
    await cancelSourceMigration(deps)
    expect(await loadMigrationJournal(deps.migration)).toBeNull()
    expect(getSdkSourceState().source).toBe('managed')
    expect(fs.exists(`${MANAGED}/platform-tools/adb`)).toBe(true)
    expect(fs.exists(`${MANAGED}/emulator/emulator`)).toBe(true)
    expect(fs.exists(CUSTOM)).toBe(false)
    expect(fs.read(`${AVD_HOME}/d1.avd/config.ini`)).toContain(`image.sys.src.dir=${MANAGED}/`)
  })
})

describe('来源变更监听（plan 2026-10-12-device-list-source-aware）', () => {
  it('createSwitchDeps.broadcast 仅 sdk:source-changed 触发监听器——多监听与退订（P3-7）', () => {
    const listener = vi.fn()
    const off = onSdkSourceChanged(listener)
    const deps = createSwitchDeps()
    deps.broadcast('sdk:progress', { percent: 1 })
    deps.broadcast('sdk:migrate-progress', { phase: 'scanning' })
    expect(listener).not.toHaveBeenCalled()
    deps.broadcast('sdk:source-changed', {})
    expect(listener).toHaveBeenCalledTimes(1)
    // 退订后再广播不再触达（review P3-7：显式退订取代覆盖式复位）
    off()
    deps.broadcast('sdk:source-changed', {})
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
