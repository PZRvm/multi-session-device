import { mkdir, mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createAvd, deleteAvd, avdExists, patchAvdConfig } from '../avd'

const tmpDirs: string[] = []
const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'mst-avd-'))
  tmpDirs.push(dir)
  return dir
}
afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

/** fake runner：断言参数与 env，并模拟 avdmanager 落 .ini */
const fakeRunner =
  (avdHome: string) =>
  async (args: string[], env: NodeJS.ProcessEnv): Promise<void> => {
    const name = args[args.indexOf('-n') + 1]
    await writeFile(
      join(avdHome, `${name}.ini`),
      `avd.ini.encoding=UTF-8\npath=${join(avdHome, `${name}.avd`)}\n`,
      'utf8'
    )
    expect(args.slice(0, 2)).toEqual(['create', 'avd'])
    expect(args[args.indexOf('-d') + 1]).toBe('pixel_8')
    expect(args[args.indexOf('-k') + 1]).toBe('system-images;android-36;google_apis;arm64-v8a')
    expect(env.JAVA_HOME).toBe(join('/sdk-root', 'jre', 'Contents', 'Home'))
    expect(env.ANDROID_AVD_HOME).toBe(avdHome)
    expect(env.ANDROID_SDK_ROOT).toBe('/sdk-root')
    expect(env.ANDROID_USER_HOME).toBe(join('/sdk-root', 'android-user'))
  }

const dirs = (avdHome: string): { avdHome: string; sdkRoot: string } => ({
  avdHome,
  sdkRoot: '/sdk-root'
})
const input = {
  avdName: 'mst-it-1',
  profileId: 'pixel_8',
  packageName: 'system-images;android-36;google_apis;arm64-v8a'
}

describe('createAvd env（android-user 单源，issue 2026-10-11 问题三）', () => {
  it('userHome 覆盖生效：ANDROID_USER_HOME/EMULATOR_HOME 指向应用数据目录而非 SDK 根', async () => {
    const avdHome = await makeTmp()
    await createAvd(
      input,
      { avdHome, sdkRoot: '/studio-sdk', userHome: '/userdata/android-user' },
      {
        runner: async (_args, env) => {
          await writeFile(
            join(avdHome, 'mst-it-1.ini'),
            `avd.ini.encoding=UTF-8\npath=${join(avdHome, 'mst-it-1.avd')}\n`,
            'utf8'
          )
          expect(env.ANDROID_USER_HOME).toBe('/userdata/android-user')
          expect(env.ANDROID_EMULATOR_HOME).toBe('/userdata/android-user')
          expect(env.ANDROID_SDK_ROOT).toBe('/studio-sdk')
        }
      }
    )
  })

  it('缺省回落 SDK 根内旧布局（向后兼容）', async () => {
    const avdHome = await makeTmp()
    await createAvd(
      input,
      { avdHome, sdkRoot: '/sdk-root' },
      {
        runner: async (_args, env) => {
          await writeFile(
            join(avdHome, 'mst-it-1.ini'),
            `avd.ini.encoding=UTF-8\npath=${join(avdHome, 'mst-it-1.avd')}\n`,
            'utf8'
          )
          expect(env.ANDROID_USER_HOME).toBe(join('/sdk-root', 'android-user'))
        }
      }
    )
  })
})

describe('createAvd（avdmanager 子进程，注入执行器）', () => {
  it('参数/env 正确，落 .ini 后视为成功', async () => {
    const avdHome = await makeTmp()
    await mkdir(avdHome, { recursive: true })
    const runner = vi.fn(fakeRunner(avdHome))
    await createAvd(input, dirs(avdHome), { runner })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(await avdExists('mst-it-1', dirs(avdHome))).toBe(true)
  })

  it('runner 成功但没落 .ini → 视为失败（零部分成功的 AVD 侧）', async () => {
    const avdHome = await makeTmp()
    await expect(createAvd(input, dirs(avdHome), { runner: async () => {} })).rejects.toThrow(
      '未产出 AVD 目录'
    )
  })

  it('avdmanager 失败 → 错误原样上抛', async () => {
    const avdHome = await makeTmp()
    await expect(
      createAvd(input, dirs(avdHome), {
        runner: async () => {
          throw new Error('exit 1：Bad request')
        }
      })
    ).rejects.toThrow('exit 1')
  })

  it('非法 AVD 名（路径穿越）拒绝', async () => {
    const avdHome = await makeTmp()
    await expect(createAvd({ ...input, avdName: '../escape' }, dirs(avdHome))).rejects.toThrow(
      '非法 AVD 名'
    )
  })

  it('重复创建拒绝', async () => {
    const avdHome = await makeTmp()
    await mkdir(avdHome, { recursive: true })
    await createAvd(input, dirs(avdHome), { runner: fakeRunner(avdHome) })
    await expect(createAvd(input, dirs(avdHome), { runner: fakeRunner(avdHome) })).rejects.toThrow(
      'AVD 已存在'
    )
  })
})

describe('deleteAvd', () => {
  it('目录与 ini 一并删除', async () => {
    const avdHome = await makeTmp()
    await mkdir(avdHome, { recursive: true })
    await createAvd(input, dirs(avdHome), { runner: fakeRunner(avdHome) })
    await deleteAvd('mst-it-1', dirs(avdHome))
    expect(await avdExists('mst-it-1', dirs(avdHome))).toBe(false)
  })

  it('文件缺失按已删成功（force 语义）', async () => {
    const avdHome = await makeTmp()
    await expect(deleteAvd('mst-never-existed', dirs(avdHome))).resolves.toBeUndefined()
  })
})

describe('patchAvdConfig（真实 tmp 目录读写）', () => {
  it('白名单键全量重写、未知键与注释保留；同键多行全部重写（review P3：末次优先不被旧行盖掉）', async () => {
    const avdHome = await makeTmp()
    const configDir = join(avdHome, 'test.avd')
    await mkdir(configDir, { recursive: true })
    const original = [
      '# 生成注释保留',
      'hw.cpu.ncore=2',
      'unknown.key=keep',
      'hw.cpu.ncore=8',
      ''
    ].join('\n')
    await writeFile(join(configDir, 'config.ini'), original, 'utf8')

    await patchAvdConfig('test', dirs(avdHome), { 'hw.cpu.ncore': '6' })

    const patched = await readFile(join(configDir, 'config.ini'), 'utf8')
    // properties 末次读取优先：两处重复键都必须重写，只改首处会被旧行盖掉
    expect(patched.split('\n').filter((line) => line.startsWith('hw.cpu.ncore='))).toEqual([
      'hw.cpu.ncore=6',
      'hw.cpu.ncore=6'
    ])
    expect(patched).toContain('unknown.key=keep')
    expect(patched).toContain('# 生成注释保留')
  })
})

describe('deleteAvd containment 守卫（review P2-6 回归锚）', () => {
  it('合法 avdHome + 白名单名：守卫放行，正常删除', async () => {
    const avdHome = await makeTmp()
    await mkdir(avdHome, { recursive: true })
    await writeFile(join(avdHome, 'guard-ok.ini'), 'path=x\n', 'utf8')
    await mkdir(join(avdHome, 'guard-ok.avd'), { recursive: true })
    await deleteAvd('guard-ok', dirs(avdHome))
    const names = await readdir(avdHome)
    expect(names.some((name) => name.startsWith('guard-ok'))).toBe(false)
  })

  it('怪形态 avdHome（含 ..）不误拒：avdPaths 的 join 先规范化，根外文件不受影响', async () => {
    const base = await makeTmp()
    // `sub/..` 规范化后等价于 base：目标文件在 base 下，sub 是无关目录
    await mkdir(join(base, 'target.avd'), { recursive: true })
    await writeFile(join(base, 'target.ini'), 'path=x\n', 'utf8')
    await mkdir(join(base, 'sub'), { recursive: true })
    await writeFile(join(base, 'sub', 'unrelated.txt'), 'keep', 'utf8')
    // 守卫不误判（resolve 后 containment 成立）；拒绝分支在白名单名（无分隔符）下
    // 不可达，属纵深防御——本用例锚定不误拒 + 只删目标两条路径
    await expect(deleteAvd('target', dirs(join(base, 'sub', '..')))).resolves.toBeUndefined()
    const names = await readdir(base)
    expect(names.some((name) => name.startsWith('target'))).toBe(false)
    expect(names).toContain('sub')
    expect(await readFile(join(base, 'sub', 'unrelated.txt'), 'utf8')).toBe('keep')
  })
})
