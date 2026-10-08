// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeviceMeta } from '@shared/types'
import {
  MAX_CONFIG_BYTES,
  checkDeviceHealth,
  parseProperties,
  runReconciliation,
  type ReconcileDirs
} from '../reconcile'

const tmpDirs: string[] = []
const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'msd-reconcile-'))
  tmpDirs.push(dir)
  return dir
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const NOW = 1_728_000_000_000
const now = (): number => NOW

const IMAGE_DIR_SEGMENTS = ['android-36.1', 'google_apis', 'arm64-v8a']
const IMAGE_PACKAGE = `system-images;${IMAGE_DIR_SEGMENTS.join(';')}`

const metaOf = (id: string, overrides: Partial<DeviceMeta> = {}): DeviceMeta => ({
  id,
  name: '测试机',
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: IMAGE_PACKAGE,
  apiDisplay: '36.1',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  ...overrides
})

const UUID_A = '11111111-2222-3333-4444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const UUID_ORPHAN = '99999999-8888-7777-6666-555555555555'

const packageXmlFor = (packageName: string): string => `<?xml version="1.0"?>
<sdk:repository xmlns:sdk="http://schemas.android.com/repository/android/common/02">
  <localPackage path="${packageName}" obsolete="false">
    <type-details>xsi:type="sdk:sysImgDetailsType"</type-details>
    <revision><major>1</major></revision>
  </localPackage>
</sdk:repository>
`

interface Roots {
  base: string
  avdHome: string
  sdkRoot: string
  skinsRoot: string
  dirs: ReconcileDirs
}

const makeRoots = async (): Promise<Roots> => {
  const base = await makeTmp()
  const avdHome = join(base, 'avd-home')
  const sdkRoot = join(base, 'AndroidSDK')
  const skinsRoot = join(base, 'device-skins')
  await mkdir(avdHome, { recursive: true })
  await mkdir(sdkRoot, { recursive: true })
  await mkdir(skinsRoot, { recursive: true })
  return { base, avdHome, sdkRoot, skinsRoot, dirs: { avdHome, sdkRoot, skinsRoot } }
}

/** 安装一个完整镜像（package.xml 身份与目录一致） */
const installImage = async (
  roots: Roots,
  segments: string[] = IMAGE_DIR_SEGMENTS,
  packageName: string = IMAGE_PACKAGE
): Promise<string> => {
  const dir = join(roots.sdkRoot, 'system-images', ...segments)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.xml'), packageXmlFor(packageName), 'utf8')
  await writeFile(join(dir, 'source.properties'), 'Pkg.Desc=System Image\n', 'utf8')
  await writeFile(join(dir, 'system.img'), 'fake-image', 'utf8')
  return dir
}

interface AvdOptions {
  iniPath?: string | null
  sysdir?: string
  abi?: string
  extraConfig?: string[]
  omitConfig?: boolean
  omitIni?: boolean
  omitDir?: boolean
}

/** 写一台 AVD 的三主体（默认完整合法） */
const writeAvd = async (roots: Roots, id: string, options: AvdOptions = {}): Promise<void> => {
  const avdDir = join(roots.avdHome, `${id}.avd`)
  if (!options.omitDir) {
    await mkdir(avdDir, { recursive: true })
  }
  if (!options.omitIni) {
    const declared = options.iniPath === undefined ? avdDir : options.iniPath
    await writeFile(
      join(roots.avdHome, `${id}.ini`),
      `avd.ini.encoding=UTF-8\npath=${declared}\ntarget=android-36.1\n`,
      'utf8'
    )
  }
  if (!options.omitConfig && !options.omitDir) {
    const lines = [
      'avd.ini.encoding=UTF-8',
      `abi.type=${options.abi ?? 'arm64-v8a'}`,
      `image.sysdir.1=${options.sysdir ?? `system-images/${IMAGE_DIR_SEGMENTS.join('/')}/`}`,
      'tag.display=Google APIs',
      'hw.lcd.density=420',
      'hw.lcd.width=1080',
      'hw.lcd.height=2400',
      ...(options.extraConfig ?? [])
    ]
    await writeFile(join(avdDir, 'config.ini'), `${lines.join('\n')}\n`, 'utf8')
  }
}

describe('parseProperties', () => {
  it('注释/空行忽略；同键末次值优先；同值重复合法、冲突值进 conflicts', () => {
    const parsed = parseProperties(
      [
        '# 注释',
        '! 惊叹注释',
        '',
        'a=1',
        'a=1',
        'a=2',
        'b = spaced ',
        'not-a-pair',
        'weird$key=3'
      ].join('\n')
    )
    expect(parsed.values.get('a')).toBe('2')
    expect(parsed.values.get('b')).toBe('spaced')
    // 非法键（$）与无等号行按未知内容忽略
    expect(parsed.values.has('weird$key')).toBe(false)
    expect(parsed.conflicts.has('a')).toBe(true)
    expect(parsed.conflicts.has('b')).toBe(false)
  })
})

describe('单目标核验 checkDeviceHealth', () => {
  it('完整 AVD + 完整镜像 → valid；不读镜像内容也能给出 checkedAt', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('valid')
    expect(availability.issues).toEqual([])
    expect(availability.checkedAt).toBe(NOW)
  })

  it('.ini / .avd 目录 / config.ini 任一缺失 → missing 且 code 区分', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A, { omitIni: true })
    let availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('missing')
    expect(availability.issues.map((issue) => issue.code)).toContain('ini-missing')

    await writeAvd(roots, UUID_B, { omitDir: true })
    availability = await checkDeviceHealth(metaOf(UUID_B), roots.dirs, { now })
    expect(availability.state).toBe('missing')
    expect(availability.issues.map((issue) => issue.code)).toContain('avd-dir-missing')

    await writeAvd(roots, UUID_ORPHAN, { omitConfig: true })
    availability = await checkDeviceHealth(metaOf(UUID_ORPHAN), roots.dirs, { now })
    expect(availability.state).toBe('missing')
    expect(availability.issues.map((issue) => issue.code)).toContain('config-missing')
  })

  it('ini/config 符号链接 → unsafe（不追随读取）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await rm(join(roots.avdHome, `${UUID_A}.ini`))
    await writeFile(join(roots.base, 'evil.ini'), 'path=/tmp/evil\n', 'utf8')
    await symlink(join(roots.base, 'evil.ini'), join(roots.avdHome, `${UUID_A}.ini`))
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('unsafe')
    expect(availability.issues.map((issue) => issue.code)).toContain('ini-symlink')

    await writeAvd(roots, UUID_B)
    await rm(join(roots.avdHome, `${UUID_B}.avd`, 'config.ini'))
    await symlink(join(roots.base, 'evil.ini'), join(roots.avdHome, `${UUID_B}.avd`, 'config.ini'))
    const second = await checkDeviceHealth(metaOf(UUID_B), roots.dirs, { now })
    expect(second.state).toBe('unsafe')
    expect(second.issues.map((issue) => issue.code)).toContain('config-symlink')
  })

  it('ini.path 与实际 .avd 不一致 → broken；指向不存在位置 → broken', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    // 声明指向另一个真实存在的目录 → 归属不一致
    await mkdir(join(roots.avdHome, 'somewhere-else.avd'), { recursive: true })
    await writeAvd(roots, UUID_A, { iniPath: join(roots.avdHome, 'somewhere-else.avd') })
    let availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('broken')
    expect(availability.issues.map((issue) => issue.code)).toContain('ini-path-mismatch')

    await writeAvd(roots, UUID_B, { iniPath: '/tmp/nonexistent-escape.avd' })
    availability = await checkDeviceHealth(metaOf(UUID_B), roots.dirs, { now })
    expect(availability.issues.map((issue) => issue.code)).toContain('ini-path-invalid')
  })

  it('关键键冲突重复 → broken；同值重复合法；关键项不可解析 → broken', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A, {
      extraConfig: [
        'hw.lcd.width=1080',
        'hw.lcd.width=1344',
        'abi.type=arm64-v8a',
        'abi.type=arm64-v8a'
      ]
    })
    let availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('broken')
    expect(availability.issues.map((issue) => issue.code)).toContain('config-conflict')

    await writeAvd(roots, UUID_B, {
      extraConfig: ['abi.type=arm64-v8a', 'hw.lcd.density=abc']
    })
    availability = await checkDeviceHealth(metaOf(UUID_B), roots.dirs, { now })
    expect(availability.issues.map((issue) => issue.code)).toContain('config-invalid-lcd')
  })

  it('image.sysdir.1 空/缺失 → broken；相对路径含逃逸段 → unsafe；绝对路径出根 → unsafe', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A, {
      sysdir: '',
      extraConfig: ['image.sysdir.1=']
    })
    const withEmpty = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(withEmpty.state).toBe('broken')
    expect(withEmpty.issues.map((issue) => issue.code)).toContain('config-missing-sysdir')

    await writeAvd(roots, UUID_B, {
      sysdir: 'system-images/../android-36.1/google_apis/arm64-v8a/'
    })
    const escaping = await checkDeviceHealth(metaOf(UUID_B), roots.dirs, { now })
    expect(escaping.state).toBe('unsafe')
    expect(escaping.issues.map((issue) => issue.code)).toContain('image-sysdir-escape')

    // 绝对路径指向 SDK 根之外的完整镜像目录 → 逃逸
    const outside = join(roots.base, 'outside-sdk', 'system-images', ...IMAGE_DIR_SEGMENTS)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'package.xml'), packageXmlFor(IMAGE_PACKAGE), 'utf8')
    await writeFile(join(outside, 'source.properties'), 'x=1\n', 'utf8')
    await writeFile(join(outside, 'system.img'), 'img', 'utf8')
    await writeAvd(roots, UUID_ORPHAN, { sysdir: join(outside) })
    const absolute = await checkDeviceHealth(metaOf(UUID_ORPHAN), roots.dirs, { now })
    expect(absolute.issues.map((issue) => issue.code)).toContain('image-sysdir-escape')
  })

  it('镜像缺失 system.img / package.xml 身份矛盾 / 元数据身份不同 → 分归因', async () => {
    const roots = await makeRoots()
    const imageDir = await installImage(roots)
    await writeAvd(roots, UUID_A)
    // 镜像自身损坏：system.img 消失 → component=image 的 missing，不冒充 AVD 被删
    await rm(join(imageDir, 'system.img'))
    let availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('missing')
    expect(availability.issues.every((issue) => issue.component === 'image')).toBe(true)
    expect(availability.issues.map((issue) => issue.code)).toContain('image-system-img-missing')

    // 身份矛盾（目录位置 vs package.xml 声明）→ broken
    await writeFile(join(imageDir, 'system.img'), 'back', 'utf8')
    await writeFile(
      join(imageDir, 'package.xml'),
      packageXmlFor('system-images;android-35;google_apis;arm64-v8a'),
      'utf8'
    )
    availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('broken')
    expect(availability.issues.map((issue) => issue.code)).toContain('image-identity-mismatch')

    // 完整但与元数据不同 → 仅 warning，状态 valid
    await writeFile(join(imageDir, 'package.xml'), packageXmlFor(IMAGE_PACKAGE), 'utf8')
    const otherMeta = metaOf(UUID_A, {
      imagePackageName: 'system-images;android-35;google_apis;arm64-v8a'
    })
    availability = await checkDeviceHealth(otherMeta, roots.dirs, { now })
    expect(availability.state).toBe('valid')
    expect(availability.issues).toHaveLength(1)
    expect(availability.issues[0]?.severity).toBe('warning')
    expect(availability.issues[0]?.code).toBe('image-identity-differs')
  })

  it('config abi.type 与实际镜像 ABI 矛盾 → broken', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A, { abi: 'x86_64' })
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('broken')
    expect(availability.issues.map((issue) => issue.code)).toContain('abi-mismatch')
  })

  it('SDK 根不可用 → 环境原因的 image issue，不冒充 AVD 缺失', async () => {
    const roots = await makeRoots()
    await writeAvd(roots, UUID_A)
    const dirs = { ...roots.dirs, sdkRoot: join(roots.base, 'no-such-sdk') }
    const availability = await checkDeviceHealth(metaOf(UUID_A), dirs, { now })
    expect(availability.issues.map((issue) => issue.code)).toContain('sdk-root-missing')
    expect(availability.issues.every((issue) => issue.component === 'image')).toBe(true)
  })

  it('skin.path 越界 → unsafe；SDK 内 / 应用皮肤库内合法', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A, { extraConfig: [`skin.path=${join(roots.base, 'outside')}`] })
    let availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('unsafe')
    expect(availability.issues.map((issue) => issue.code)).toContain('skin-path-escape')

    await writeAvd(roots, UUID_B, {
      extraConfig: [`skin.path=${join(roots.skinsRoot, 'imported-1')}`]
    })
    availability = await checkDeviceHealth(metaOf(UUID_B), roots.dirs, { now })
    expect(availability.state).toBe('valid')
  })

  it('config 超过上限 → broken（不读内容）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await writeFile(
      join(roots.avdHome, `${UUID_A}.avd`, 'config.ini'),
      `pad=${'x'.repeat(MAX_CONFIG_BYTES)}`,
      'utf8'
    )
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.issues.map((issue) => issue.code)).toContain('config-too-large')
  })
})

describe('全量对账 runReconciliation', () => {
  it('首载合并：valid 设备 + 孤立组 + 非 UUID 计数；孤儿 id 稳定排序', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await writeAvd(roots, UUID_ORPHAN) // 无元数据 → 孤立完整组
    await writeFile(join(roots.avdHome, 'ini-only-uuid.ini'), 'path=/tmp/x\n', 'utf8')
    await mkdir(join(roots.avdHome, 'studio-made.avd'), { recursive: true })
    const outcome = await runReconciliation(
      {
        metas: [metaOf(UUID_A)],
        badMetaIds: new Set(),
        transientIds: new Set(),
        dirs: roots.dirs
      },
      { now }
    )
    expect(outcome.availabilityById.get(UUID_A)?.state).toBe('valid')
    expect(outcome.orphans).toEqual([
      { id: UUID_ORPHAN, kind: 'orphan', detail: '完整组（无元数据记录）' }
    ])
    expect(outcome.unrecognizedCount).toBe(2) // ini-only-uuid（非 UUID）+ studio-made
    expect(outcome.scanError).toBeNull()
  })

  it('仅 .ini / 仅 .avd 的孤立与元数据异常关联组分开；transient id 暂缓', async () => {
    const roots = await makeRoots()
    await writeFile(join(roots.avdHome, `${UUID_A}.ini`), 'path=/tmp/a\n', 'utf8')
    await mkdir(join(roots.avdHome, `${UUID_B}.avd`), { recursive: true })
    await mkdir(join(roots.avdHome, `${UUID_ORPHAN}.avd`), { recursive: true })
    const outcome = await runReconciliation(
      {
        metas: [],
        badMetaIds: new Set([UUID_ORPHAN]),
        transientIds: new Set([UUID_A]),
        dirs: roots.dirs
      },
      { now }
    )
    expect(outcome.orphans).toEqual([
      {
        id: UUID_ORPHAN,
        kind: 'metadata-linked',
        detail: '仅 .avd 目录（缺少 .ini）（元数据异常关联）'
      },
      { id: UUID_B, kind: 'orphan', detail: '仅 .avd 目录（缺少 .ini）（无元数据记录）' }
    ])
  })

  it('根缺失 + 无设备 = 首次使用；根缺失 + 有设备 = 逐行 missing；根不是目录 = scanError', async () => {
    const roots = await makeRoots()
    await rm(roots.avdHome, { recursive: true })
    const empty = await runReconciliation(
      { metas: [], badMetaIds: new Set(), transientIds: new Set(), dirs: roots.dirs },
      { now }
    )
    expect(empty.scanError).toBeNull()

    const withDevices = await runReconciliation(
      { metas: [metaOf(UUID_A)], badMetaIds: new Set(), transientIds: new Set(), dirs: roots.dirs },
      { now }
    )
    expect(withDevices.availabilityById.get(UUID_A)?.state).toBe('missing')
    expect(withDevices.availabilityById.get(UUID_A)?.issues[0]?.code).toBe('avd-home-missing')

    const roots2 = await makeRoots()
    await rm(roots2.avdHome, { recursive: true })
    await writeFile(roots2.avdHome, 'now a file', 'utf8')
    const notDir = await runReconciliation(
      {
        metas: [metaOf(UUID_A)],
        badMetaIds: new Set(),
        transientIds: new Set(),
        dirs: roots2.dirs
      },
      { now }
    )
    expect(notDir.scanError).toContain('不是目录')
    expect(notDir.availabilityById.get(UUID_A)?.state).toBe('inaccessible')
  })

  it('根不可读（EACCES）→ scanError + 全部 inaccessible，不构造「全部已删」', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await chmod(roots.avdHome, 0o000)
    try {
      const outcome = await runReconciliation(
        {
          metas: [metaOf(UUID_A)],
          badMetaIds: new Set(),
          transientIds: new Set(),
          dirs: roots.dirs
        },
        { now }
      )
      if (outcome.scanError !== null) {
        // 非 root 环境下 chmod 生效
        expect(outcome.scanError).toContain('不可读')
        expect(outcome.availabilityById.get(UUID_A)?.state).toBe('inaccessible')
        expect(outcome.availabilityById.get(UUID_A)?.issues[0]?.code).toBe('avd-home-inaccessible')
      } else {
        // root/特权环境下 EACCES 不生效——跳过断言但确认没冒充 missing
        expect(outcome.availabilityById.get(UUID_A)?.state).not.toBe('missing')
      }
    } finally {
      await chmod(roots.avdHome, 0o755)
    }
  })

  it('检查超时 → inaccessible/check-timeout（不降格为 missing）', async () => {
    // 只假 setTimeout：真实 fs 回调仍走 setImmediate/事件循环，扫描可推进到挂起点
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const roots = await makeRoots()
      await installImage(roots)
      await writeAvd(roots, UUID_A)
      let slowReads = 0
      const slow = {
        now,
        readFile: (): Promise<string> => {
          slowReads += 1
          return new Promise(() => undefined)
        }
      }
      const run = runReconciliation(
        {
          metas: [metaOf(UUID_A)],
          badMetaIds: new Set(),
          transientIds: new Set(),
          dirs: roots.dirs
        },
        slow
      )
      // 真实 IO 冲刷到 slow.readFile 真正挂起（高负载下轮次不定，用计数收敛）
      for (let i = 0; i < 500 && slowReads === 0; i += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      await vi.advanceTimersByTimeAsync(3_100)
      const outcome = await run
      const availability = outcome.availabilityById.get(UUID_A)
      expect(availability?.state).toBe('inaccessible')
      expect(availability?.issues[0]?.code).toBe('check-timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('取消信号已中止 → 拒绝执行（迟到结果由调用方丢弃）', async () => {
    const roots = await makeRoots()
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(
      runReconciliation(
        {
          metas: [metaOf(UUID_A)],
          badMetaIds: new Set(),
          transientIds: new Set(),
          dirs: roots.dirs,
          signal: controller.signal
        },
        { now }
      )
    ).rejects.toThrow('stopped')
  })
})

describe('review 修复轮回归（判定正确性）', () => {
  it('P2-1：skin.path 为指向根外的 symlink → unsafe（词法在根内不放行）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    // 词法路径在 SDK 根内，但目标是根外的符号链接
    const skinsDir = join(roots.sdkRoot, 'skins', 'evil')
    await mkdir(join(roots.sdkRoot, 'skins'), { recursive: true })
    await symlink(roots.base, skinsDir)
    await writeAvd(roots, UUID_A, { extraConfig: [`skin.path=${skinsDir}`] })
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('unsafe')
    expect(availability.issues.map((issue) => issue.code)).toContain('skin-path-escape')
  })

  it('P2-5：相对 sysdir 的目录组件是指向根外的 symlink → unsafe', async () => {
    const roots = await makeRoots()
    // 镜像装在根外，再把 <sdkRoot>/system-images 换成指过去的符号链接
    const outsideImages = join(roots.base, 'outside-images')
    const segments = ['android-36.1', 'google_apis', 'arm64-v8a']
    const imageDir = join(outsideImages, ...segments)
    await mkdir(imageDir, { recursive: true })
    await writeFile(join(imageDir, 'package.xml'), packageXmlFor(IMAGE_PACKAGE), 'utf8')
    await writeFile(join(imageDir, 'source.properties'), 'x=1\n', 'utf8')
    await writeFile(join(imageDir, 'system.img'), 'img', 'utf8')
    await symlink(outsideImages, join(roots.sdkRoot, 'system-images'))
    await writeAvd(roots, UUID_A)
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('unsafe')
    expect(availability.issues.map((issue) => issue.code)).toContain('image-sysdir-escape')
  })

  it('P3：ini.path 相对声明含 .. → unsafe（resolve 规范化前先查原始段）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A, { iniPath: '../somewhere.avd' })
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.issues.map((issue) => issue.code)).toContain('ini-path-escape')
  })

  it('P3：avdHome 根自身是 symlink → 全员 unsafe + scanError（不当读不了降格）', async () => {
    const base = await makeTmp()
    const realHome = join(base, 'real-avd-home')
    const linkHome = join(base, 'link-avd-home')
    await mkdir(realHome, { recursive: true })
    await symlink(realHome, linkHome)
    const dirs = { avdHome: linkHome, sdkRoot: join(base, 'sdk'), skinsRoot: join(base, 'skins') }
    const outcome = await runReconciliation(
      { metas: [metaOf(UUID_A)], badMetaIds: new Set(), transientIds: new Set(), dirs },
      { now }
    )
    expect(outcome.scanError).toContain('符号链接')
    expect(outcome.availabilityById.get(UUID_A)?.state).toBe('unsafe')
    expect(outcome.availabilityById.get(UUID_A)?.issues[0]?.code).toBe('avd-home-symlink')
  })

  it('P3：共享镜像每轮只读一次——两台设备同一镜像，package.xml 只读一遍', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await writeAvd(roots, UUID_B)
    let packageXmlReads = 0
    const counting = {
      now,
      readFile: async (path: string): Promise<string> => {
        if (path.endsWith('package.xml')) packageXmlReads += 1
        return readFile(path, 'utf8')
      }
    }
    await runReconciliation(
      {
        metas: [metaOf(UUID_A), metaOf(UUID_B)],
        badMetaIds: new Set(),
        transientIds: new Set(),
        dirs: roots.dirs
      },
      counting
    )
    expect(packageXmlReads).toBe(1)
  })

  it('P3：镜像内受检文件是 symlink → unsafe/image-file-symlink（不追随读取）', async () => {
    const roots = await makeRoots()
    const imageDir = await installImage(roots)
    await writeAvd(roots, UUID_A)
    await rm(join(imageDir, 'system.img'))
    await writeFile(join(roots.base, 'evil.img'), 'x', 'utf8')
    await symlink(join(roots.base, 'evil.img'), join(imageDir, 'system.img'))
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('unsafe')
    expect(availability.issues.map((issue) => issue.code)).toContain('image-file-symlink')
  })

  it('P3：ini 超上限 → broken/ini-too-large（不读内容）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await writeFile(
      join(roots.avdHome, `${UUID_A}.ini`),
      `pad=${'x'.repeat(MAX_CONFIG_BYTES)}`,
      'utf8'
    )
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.issues.map((issue) => issue.code)).toContain('ini-too-large')
  })

  it('P3：package.xml 超上限 → broken/image-package-xml-invalid', async () => {
    const roots = await makeRoots()
    const imageDir = await installImage(roots)
    await writeAvd(roots, UUID_A)
    await writeFile(join(imageDir, 'package.xml'), `<!-- ${'x'.repeat(300 * 1024)} -->`, 'utf8')
    const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
    expect(availability.state).toBe('broken')
    expect(availability.issues.map((issue) => issue.code)).toContain('image-package-xml-invalid')
  })

  it('P3：ini 无读权限 → inaccessible（不冒充 missing/broken）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    await writeAvd(roots, UUID_A)
    await chmod(join(roots.avdHome, `${UUID_A}.ini`), 0o000)
    try {
      const availability = await checkDeviceHealth(metaOf(UUID_A), roots.dirs, { now })
      if (availability.issues.some((issue) => issue.code === 'ini-unreadable')) {
        // 非 root 环境：EACCES 生效
        expect(availability.state).toBe('inaccessible')
      } else {
        expect(availability.state).not.toBe('missing')
      }
    } finally {
      await chmod(join(roots.avdHome, `${UUID_A}.ini`), 0o644)
    }
  })

  it('P3：扫描中途 abort → 后续设备拒绝执行，整轮 reject（在飞目标由调用方丢弃）', async () => {
    const roots = await makeRoots()
    await installImage(roots)
    // 5 台 > 并发上限 4：A 的 ini 读取挂起并触发 abort，占住一条 lane；
    // 其余 lane 取下一台时在 throwIfAborted 拒绝 → Promise.all 整轮 reject
    const UUIDS = [
      UUID_A,
      UUID_B,
      UUID_ORPHAN,
      'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0',
      'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0'
    ]
    for (const id of UUIDS) await writeAvd(roots, id)
    const controller = new AbortController()
    const aborting = {
      now,
      readFile: (path: string): Promise<string> => {
        if (path.endsWith(`${UUID_A}.ini`)) {
          controller.abort(new Error('mid-scan'))
          return new Promise<string>(() => undefined)
        }
        return readFile(path, 'utf8')
      }
    }
    await expect(
      runReconciliation(
        {
          metas: UUIDS.map((id) => metaOf(id)),
          badMetaIds: new Set(),
          transientIds: new Set(),
          dirs: roots.dirs,
          signal: controller.signal
        },
        aborting
      )
    ).rejects.toThrow('mid-scan')
  })
})
