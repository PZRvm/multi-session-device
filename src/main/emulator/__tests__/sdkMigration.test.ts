// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'

import {
  MigrationCancelledError,
  classifyRoot,
  loadMigrationJournal,
  migrationJournalPath,
  planMigration,
  requiredFreeBytes,
  relinkAvdConfigs,
  resumeMigration,
  rollbackMigration,
  startMigration,
  type MigrationDeps
} from '../sdkMigration'
import { rewriteConfigPathPrefixes } from '../avd'

/** 内存文件系统：目录表 + 文件内容表 + 卷号前缀表（rename 跨卷抛 EXDEV 语义） */
export class FakeFs {
  dirs = new Map<string, Set<string>>()
  files = new Map<string, string>()
  devs = new Map<string, number>()
  fsType = 'APFS'
  freeSpace = 1_000_000_000_000
  corruptCopy = false

  constructor() {
    this.dirs.set('/', new Set())
    this.devs.set('/', 1)
  }

  private norm(path: string): string {
    return path.replace(/\/+$/, '') || '/'
  }
  private parentOf(path: string): string {
    const index = path.lastIndexOf('/')
    return index <= 0 ? '/' : path.slice(0, index)
  }
  devOf(path: string): number {
    let current = this.norm(path)
    while (true) {
      if (this.devs.has(current)) return this.devs.get(current) as number
      if (current === '/') return 1
      current = this.parentOf(current)
    }
  }
  attach(dirPath: string): void {
    if (dirPath === '/' || this.dirs.has(dirPath)) return
    this.attach(this.parentOf(dirPath))
    this.dirs.set(dirPath, new Set())
    this.dirs.get(this.parentOf(dirPath))?.add(dirPath.split('/').pop() as string)
  }
  mkdirP(path: string): void {
    this.attach(this.norm(path))
  }
  write(path: string, content: string): void {
    const normalized = this.norm(path)
    this.attach(this.parentOf(normalized))
    this.files.set(normalized, content)
    this.dirs.get(this.parentOf(normalized))?.add(normalized.split('/').pop() as string)
  }
  read(path: string): string {
    const content = this.files.get(this.norm(path))
    if (content === undefined) throw new Error(`ENOENT ${path}`)
    return content
  }
  exists(path: string): boolean {
    const normalized = this.norm(path)
    return this.files.has(normalized) || this.dirs.has(normalized)
  }
  listDir(path: string): string[] {
    const children = this.dirs.get(this.norm(path))
    if (children === undefined) throw new Error(`ENOENT ${path}`)
    return [...children]
  }
  rmTree(path: string): void {
    const normalized = this.norm(path)
    if (this.dirs.has(normalized)) {
      for (const child of this.listDir(normalized)) this.rmTree(`${normalized}/${child}`)
      this.dirs.delete(normalized)
    } else {
      this.files.delete(normalized)
    }
    const parent = this.parentOf(normalized)
    this.dirs.get(parent)?.delete(normalized.split('/').pop() as string)
  }
  rename(from: string, to: string): void {
    const fromNorm = this.norm(from)
    const toNorm = this.norm(to)
    if (this.devOf(fromNorm) !== this.devOf(toNorm)) {
      throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' })
    }
    if (this.dirs.has(fromNorm)) {
      for (const child of this.listDir(fromNorm))
        this.rename(`${fromNorm}/${child}`, `${toNorm}/${child}`)
      this.dirs.delete(fromNorm)
    } else {
      const content = this.read(fromNorm)
      this.files.delete(fromNorm)
      this.write(toNorm, content)
    }
    const parent = this.parentOf(fromNorm)
    this.dirs.get(parent)?.delete(fromNorm.split('/').pop() as string)
  }
  copy(from: string, to: string): void {
    const content = this.read(from)
    this.write(to, this.corruptCopy ? content.slice(0, -1) : content)
  }
}

export const FROM = '/from-sdk'
export const TO = '/to-sdk'
export const AVD_HOME = '/avd-home'

/** 标准源根：五组件 + 一个镜像目录 + 皮肤目录；目标根默认空 */
export const seedSource = (fs: FakeFs): void => {
  for (const marker of [
    'cmdline-tools/latest/bin/sdkmanager',
    'platform-tools/adb',
    'emulator/emulator',
    'jre/Contents/Home/bin/java',
    'licenses/android-sdk-license'
  ]) {
    fs.write(`${FROM}/${marker}`, `bin:${marker}`)
  }
  fs.write(`${FROM}/system-images/android-34/google_apis/arm64-v8a/snapshot.img`, 'x'.repeat(1000))
  fs.write(`${FROM}/skins/pixel/skin`, 'skin')
  fs.write(`${FROM}/android-user/prefs.xml`, '<prefs/>')
  fs.write(`${FROM}/.tmp-cmdline-tools/leftover.bin`, 'stale')
}

export const seedAvdHome = (fs: FakeFs): void => {
  fs.mkdirP(`${AVD_HOME}/device1.avd`)
  fs.write(
    `${AVD_HOME}/device1.avd/config.ini`,
    [
      'avd.ini.encoding=UTF-8',
      `image.sys.src.dir=${FROM}/system-images/android-34/google_apis/arm64-v8a`,
      `skin.path=${FROM}/skins/pixel`,
      'tag.display=Pixel 8',
      '# comment stays'
    ].join('\n')
  )
  fs.mkdirP(`${AVD_HOME}/device2.avd`)
  fs.write(
    `${AVD_HOME}/device2.avd/config.ini`,
    `image.sys.src.dir=${FROM}/system-images/android-99/google_apis/arm64-v8a\n`
  )
}

export const makeDeps = (fs: FakeFs): MigrationDeps => ({
  listDir: async (path) => fs.listDir(path),
  statEntry: async (path) => {
    const normalized = path.replace(/\/+$/, '') || '/'
    if (!fs.exists(normalized)) throw new Error(`ENOENT ${path}`)
    return {
      isDir: fs.dirs.has(normalized),
      size: fs.dirs.has(normalized) ? 0 : (fs.files.get(normalized) as string).length,
      dev: fs.devOf(normalized)
    }
  },
  mkdirP: async (path) => fs.mkdirP(path),
  renameEntry: async (from, to) => fs.rename(from, to),
  rmTree: async (path) => fs.rmTree(path),
  copyFileTo: async (from, to) => fs.copy(from, to),
  freeSpaceOf: async () => fs.freeSpace,
  fsTypeOf: async () => fs.fsType,
  pathExists: async (path) => fs.exists(path),
  readFile: async (path) => fs.read(path),
  writeFile: async (path, data) => fs.write(path, data),
  detectSnapshot: async (root) => ({
    root,
    jre: { present: fs.exists(`${root}/jre/Contents/Home/bin/java`) },
    cmdlineTools: { present: fs.exists(`${root}/cmdline-tools/latest/bin/sdkmanager`) },
    platformTools: { present: fs.exists(`${root}/platform-tools/adb`) },
    emulator: { present: fs.exists(`${root}/emulator/emulator`) },
    licensed: fs.exists(`${root}/licenses/android-sdk-license`)
  }),
  journalDir: () => '/userdata'
})

describe('planMigration（预检）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    seedSource(fs)
    fs.devs.set(TO, 2) // 默认跨卷
  })

  it('全过：条目扫描（清 .tmp- 残留）、体量、跨卷与基线快照', async () => {
    const result = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      makeDeps(fs)
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.sameVolume).toBe(false)
    expect(result.plan.replaceTarget).toBe(false)
    expect(result.plan.entries.map((entry) => entry.name).sort()).toEqual([
      'android-user',
      'cmdline-tools',
      'emulator',
      'jre',
      'licenses',
      'platform-tools',
      'skins',
      'system-images'
    ])
    expect(result.plan.totalBytes).toBeGreaterThan(1000)
    expect(result.plan.beforeComponents).toEqual({
      jre: true,
      cmdlineTools: true,
      platformTools: true,
      emulator: true,
      licensed: true
    })
    // .tmp- 残留在扫描时清掉
    expect(fs.exists(`${FROM}/.tmp-cmdline-tools/leftover.bin`)).toBe(false)
  })

  it('逐项拒绝：运行会话 / 同根与嵌套 / 空 source / journal 在途', async () => {
    const deps = makeDeps(fs)
    const base = {
      fromRoot: FROM,
      toRoot: TO,
      targetSource: 'custom' as const,
      replaceTarget: false
    }
    expect((await planMigration({ ...base, runningCount: 1 }, deps)).ok).toBe(false)
    expect((await planMigration({ ...base, fromRoot: TO, runningCount: 0 }, deps)).ok).toBe(false)
    expect(
      (await planMigration({ ...base, toRoot: `${FROM}/nested`, runningCount: 0 }, deps)).ok
    ).toBe(false)
    fs.rmTree(FROM)
    fs.mkdirP(FROM)
    const empty = await planMigration({ ...base, runningCount: 0 }, deps)
    expect(empty).toMatchObject({ ok: false, code: 'empty-source' })
    seedSource(fs)
    fs.write(
      '/userdata/sdk-migration.json',
      '{"version":1,"fromRoot":"/x","toRoot":"/y","targetSource":"custom","targetCleared":false,"entries":[],"phase":"moving","movedBytes":0,"totalBytes":0}'
    )
    const pending = await planMigration({ ...base, runningCount: 0 }, deps)
    expect(pending).toMatchObject({ ok: false, code: 'journal-pending' })
  })

  it('目标根三分支：杂物拒绝；已有 SDK 未选替换拒绝、选替换放行', async () => {
    const deps = makeDeps(fs)
    fs.write(`${TO}/random.txt`, 'junk')
    const junk = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      deps
    )
    expect(junk).toMatchObject({ ok: false, code: 'target-junk' })

    fs.rmTree(TO)
    fs.write(`${TO}/platform-tools/adb`, 'foreign adb')
    const noReplace = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      deps
    )
    expect(noReplace).toMatchObject({ ok: false, code: 'target-sdk-no-replace' })

    const replace = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: true, runningCount: 0 },
      deps
    )
    expect(replace.ok).toBe(true)
    if (replace.ok) expect(replace.plan.replaceTarget).toBe(true)
  })

  it('FAT/exFAT 目标卷拒绝；跨卷空间不足拒绝（口径 = 体量×1.05+200MB）', async () => {
    const deps = makeDeps(fs)
    fs.fsType = 'exFAT'
    const fat = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      deps
    )
    expect(fat).toMatchObject({ ok: false, code: 'fs-unsupported' })

    fs.fsType = 'APFS'
    const total = (await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      makeDeps(fs)
    )) as { ok: true; plan: { totalBytes: number } }
    fs.freeSpace = requiredFreeBytes(total.plan.totalBytes) - 1
    const tight = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      deps
    )
    expect(tight).toMatchObject({ ok: false, code: 'space' })
    fs.freeSpace = requiredFreeBytes(total.plan.totalBytes)
    const enough = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      deps
    )
    expect(enough.ok).toBe(true)
  })
})

describe('startMigration（执行）', () => {
  let fs: FakeFs
  beforeEach(() => {
    fs = new FakeFs()
    seedSource(fs)
    seedAvdHome(fs)
  })

  const planAndRun = async (
    opts: {
      sameVolume?: boolean
      onProgress?: (p: { phase: string; percent: number; currentEntry: string | null }) => void
      signal?: AbortSignal
    } = {}
  ): Promise<ReturnType<typeof startMigration>> => {
    if (opts.sameVolume) fs.devs.set(TO, 1)
    else fs.devs.set(TO, 2)
    const deps = makeDeps(fs)
    const plan = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'custom', replaceTarget: false, runningCount: 0 },
      deps
    )
    if (!plan.ok) throw new Error(`plan failed: ${plan.code}`)
    return startMigration(
      plan.plan,
      { avdHome: AVD_HOME, signal: opts.signal, onProgress: opts.onProgress },
      deps
    )
  }

  it('同卷：rename 直移 + relink 改写（同路径在场）+ journal 落 done + 源根清空删除', async () => {
    await planAndRun({ sameVolume: true })
    expect(fs.exists(FROM)).toBe(false)
    expect(fs.exists(`${TO}/platform-tools/adb`)).toBe(true)
    expect(fs.exists(`${TO}/system-images/android-34/google_apis/arm64-v8a/snapshot.img`)).toBe(
      true
    )
    const journal = await loadMigrationJournal(makeDeps(fs))
    expect(journal?.phase).toBe('done')
    expect(journal?.entries.every((entry) => entry.done)).toBe(true)

    const config1 = fs.read(`${AVD_HOME}/device1.avd/config.ini`)
    expect(config1).toContain(
      `image.sys.src.dir=${TO}/system-images/android-34/google_apis/arm64-v8a`
    )
    expect(config1).toContain(`skin.path=${TO}/skins/pixel`)
    expect(config1).toContain('# comment stays')
    // 镜像不在新根的引用保留原值（device2 绑定保留根语义由共享/保留态测试覆盖）
    expect(fs.read(`${AVD_HOME}/device2.avd/config.ini`)).toContain(FROM)
  })

  it('跨卷：copy+校验+归位+删源；进度按字节推进', async () => {
    const events: { phase: string; percent: number }[] = []
    await planAndRun({
      onProgress: (p) => events.push({ phase: p.phase, percent: p.percent })
    })
    expect(fs.exists(FROM)).toBe(false)
    expect(fs.exists(`${TO}/emulator/emulator`)).toBe(true)
    expect(fs.exists(`${TO}/.migrating`)).toBe(false)
    const percents = events.filter((e) => e.phase === 'moving').map((e) => e.percent)
    expect(Math.max(...percents)).toBeGreaterThan(0)
    expect(events.at(-1)?.phase).toBe('done')
  })

  it('替换分支：目标已有 SDK 先清（journal targetCleared）再移', async () => {
    fs.devs.set(TO, 1)
    fs.write(`${TO}/platform-tools/adb`, 'foreign adb')
    fs.write(`${TO}/foreign-dir/readme.txt`, 'old sdk content')
    const deps = makeDeps(fs)
    const plan = await planMigration(
      { fromRoot: FROM, toRoot: TO, targetSource: 'managed', replaceTarget: true, runningCount: 0 },
      deps
    )
    if (!plan.ok) throw new Error(plan.code)
    await startMigration(plan.plan, { avdHome: AVD_HOME }, deps)
    expect(fs.exists(`${TO}/foreign-dir`)).toBe(false)
    const journal = await loadMigrationJournal(deps)
    expect(journal?.targetCleared).toBe(true)
    expect(fs.read(`${TO}/platform-tools/adb`)).toContain('bin:')
  })

  it('校验失败：journal 落 failed 带错误、源条目仍在（copy-then-delete 保完整）', async () => {
    fs.devs.set(TO, 2)
    fs.corruptCopy = true
    await expect(planAndRun()).rejects.toThrow('verify failed')
    const journal = await loadMigrationJournal(makeDeps(fs))
    expect(journal?.phase).toBe('failed')
    expect(journal?.error).toContain('verify failed')
    expect(fs.exists(`${FROM}/system-images`)).toBe(true)
    fs.corruptCopy = false
  })

  it('中途取消：journal 停在已移条目 → resume 幂等续跑至完成', async () => {
    const controller = new AbortController()
    // 第一个 moving 进度到达即取消：至少 0 个条目完成，journal 保持 failed/cancelled
    let firstEntryReported = false
    await expect(
      planAndRun({
        sameVolume: true,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'moving' && !firstEntryReported) {
            firstEntryReported = true
            controller.abort()
          }
        }
      })
    ).rejects.toBeInstanceOf(MigrationCancelledError)

    const journal = await loadMigrationJournal(makeDeps(fs))
    expect(journal?.phase).toBe('failed')
    const doneCount = journal?.entries.filter((entry) => entry.done).length ?? 0
    expect(doneCount).toBeLessThan(journal?.entries.length ?? 0)

    // resume：已完成条目跳过（rename 幂等跳过——目录已不在源），其余走完
    fs.devs.set(TO, 1)
    await resumeMigration({ avdHome: AVD_HOME }, makeDeps(fs))
    expect(fs.exists(FROM)).toBe(false)
    expect(fs.exists(`${TO}/licenses/android-sdk-license`)).toBe(true)
    const after = await loadMigrationJournal(makeDeps(fs))
    expect(after?.phase).toBe('done')
  })

  it('取消后回滚：已移条目送回源根、journal 清除、空目标根删除、relink 反向', async () => {
    // 先完整迁移一次（同卷），再手工伪造「半迁移 journal」驱动回滚
    fs.devs.set(TO, 1)
    await planAndRun({ sameVolume: true })
    const deps = makeDeps(fs)
    const finished = await loadMigrationJournal(deps)
    expect(finished?.phase).toBe('done')

    // 伪造半迁移状态：目标有条目、journal 记 done 一半、源也有一半
    fs.mkdirP(FROM)
    fs.rename(`${TO}/licenses`, `${FROM}/licenses`)
    fs.rename(`${TO}/platform-tools`, `${FROM}/platform-tools`)
    const half: typeof finished = {
      ...(finished as NonNullable<typeof finished>),
      phase: 'moving',
      entries: (finished as NonNullable<typeof finished>).entries.map((entry) => ({
        ...entry,
        done: !['licenses', 'platform-tools'].includes(entry.name)
      }))
    }
    fs.write(migrationJournalPath(deps), JSON.stringify(half))
    await rollbackMigration({ avdHome: AVD_HOME }, deps)
    expect(await loadMigrationJournal(deps)).toBeNull()
    for (const marker of [
      'cmdline-tools/latest/bin/sdkmanager',
      'platform-tools/adb',
      'emulator/emulator',
      'jre/Contents/Home/bin/java',
      'licenses/android-sdk-license',
      'system-images/android-34/google_apis/arm64-v8a/snapshot.img'
    ]) {
      expect(fs.exists(`${FROM}/${marker}`)).toBe(true)
    }
    // 回滚后 relink 反向：device1 引用指回源根
    expect(fs.read(`${AVD_HOME}/device1.avd/config.ini`)).toContain(`image.sys.src.dir=${FROM}/`)
    // 目标根已空 → 删除
    expect(fs.exists(TO)).toBe(false)
  })
})

describe('relink 与纯函数', () => {
  it('rewriteConfigPathPrefixes：同键多行全改、非路径键与注释不动、目标无同路径不改', async () => {
    const content = [
      'avd.ini.encoding=UTF-8',
      `image.sys.src.dir=/old/system-images/a`,
      `image.sys.src.dir=/old/system-images/b`,
      'hw.ramSize=2048',
      '# image.sys.src.dir=/old/comment'
    ].join('\n')
    const available = new Set(['system-images/a'])
    const result = await rewriteConfigPathPrefixes(content, '/old', '/new', (rel) =>
      available.has(rel)
    )
    expect(result.rewritten).toEqual([
      { key: 'image.sys.src.dir', from: '/old/system-images/a', to: '/new/system-images/a' }
    ])
    expect(result.content).toContain('image.sys.src.dir=/new/system-images/a')
    expect(result.content).toContain('image.sys.src.dir=/old/system-images/b')
    expect(result.content).toContain('hw.ramSize=2048')
    expect(result.content).toContain('# image.sys.src.dir=/old/comment')
  })

  it('relinkAvdConfigs：共享根引用天然不动（前缀不匹配）', async () => {
    const fs = new FakeFs()
    fs.mkdirP(`${AVD_HOME}/d.avd`)
    fs.write(`${AVD_HOME}/d.avd/config.ini`, 'image.sys.src.dir=/studio-sdk/system-images/x\n')
    const result = await relinkAvdConfigs(
      { avdHome: AVD_HOME, fromRoot: FROM, toRoot: TO },
      makeDeps(fs)
    )
    expect(result.configs).toBe(0)
    expect(fs.read(`${AVD_HOME}/d.avd/config.ini`)).toContain('/studio-sdk/')
  })
})

describe('classifyRoot', () => {
  it('不存在/空 = empty；可识别 = sdk；有杂物 = junk', async () => {
    const fs = new FakeFs()
    const deps = makeDeps(fs)
    expect(await classifyRoot('/nowhere', deps)).toBe('empty')
    fs.mkdirP('/empty-root')
    expect(await classifyRoot('/empty-root', deps)).toBe('empty')
    fs.write('/junk-root/readme.txt', 'x')
    expect(await classifyRoot('/junk-root', deps)).toBe('junk')
    fs.write('/sdk-root/emulator/emulator', 'bin')
    expect(await classifyRoot('/sdk-root', deps)).toBe('sdk')
  })
})
