import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { SdkSnapshot } from '@shared/types'
import {
  bootstrapSdk,
  detectSdk,
  parseSdkManagerPercent,
  planBootstrap,
  sdkPaths,
  writeLicenseFiles,
  ANDROID_SDK_LICENSE_HASHES
} from '../sdk'
import { createHash } from 'node:crypto'

// androidUserHome 单源引入 electron app（issue 2026-10-11 问题三）——node 环境补桩
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex')
const sha1 = (data: string): string => createHash('sha1').update(data).digest('hex')

const tmpDirs: string[] = []

const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'mst-sdk-'))
  tmpDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

const writeSourceProps = async (dir: string, revision: string): Promise<void> => {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'source.properties'), `Pkg.Revision=${revision}\n`, 'utf8')
}

const snapshotAt = (root: string): SdkSnapshot => ({
  root,
  jre: { present: false },
  cmdlineTools: { present: false },
  platformTools: { present: false },
  emulator: { present: false },
  licensed: false
})

describe('detectSdk', () => {
  it('空目录全缺且未许可', async () => {
    const root = await makeTmp()
    const snapshot = await detectSdk(root)
    expect(snapshot.jre.present).toBe(false)
    expect(snapshot.cmdlineTools.present).toBe(false)
    expect(snapshot.platformTools.present).toBe(false)
    expect(snapshot.emulator.present).toBe(false)
    expect(snapshot.licensed).toBe(false)
  })

  it('特征路径齐全即已装并读出版本', async () => {
    const root = await makeTmp()
    await mkdir(join(root, 'jre', 'Contents', 'Home', 'bin'), { recursive: true })
    await writeFile(join(root, 'jre', 'Contents', 'Home', 'bin', 'java'), '', 'utf8')
    await writeSourceProps(join(root, 'platform-tools'), '36.0.0')
    await mkdir(join(root, 'platform-tools'), { recursive: true })
    await writeFile(join(root, 'platform-tools', 'adb'), '', 'utf8')
    const snapshot = await detectSdk(root)
    expect(snapshot.jre.present).toBe(true)
    expect(snapshot.platformTools.present).toBe(true)
    expect(snapshot.platformTools.version).toBe('36.0.0')
    expect(snapshot.emulator.present).toBe(false)
  })
})

describe('planBootstrap', () => {
  it('全缺 = 全序列（许可最前）', () => {
    expect(planBootstrap(snapshotAt('/x'))).toEqual([
      'licenses',
      'jre',
      'cmdline-tools',
      'platform-tools',
      'emulator'
    ])
  })

  it('已就绪 = 空计划', () => {
    const ready: SdkSnapshot = {
      ...snapshotAt('/x'),
      jre: { present: true },
      cmdlineTools: { present: true },
      platformTools: { present: true },
      emulator: { present: true },
      licensed: true
    }
    expect(planBootstrap(ready)).toEqual([])
  })

  it('只缺 emulator 时只补 emulator', () => {
    const partial: SdkSnapshot = {
      ...snapshotAt('/x'),
      jre: { present: true },
      cmdlineTools: { present: true },
      platformTools: { present: true }
    }
    expect(planBootstrap(partial)).toEqual(['licenses', 'emulator'])
  })
})

describe('writeLicenseFiles', () => {
  it('写入两份许可文件且内容含标准哈希', async () => {
    const root = await makeTmp()
    await writeLicenseFiles(root)
    const license = await readFile(join(root, 'licenses', 'android-sdk-license'), 'utf8')
    expect(license).toContain(ANDROID_SDK_LICENSE_HASHES[0])
    expect(license).toContain(ANDROID_SDK_LICENSE_HASHES[1])
    const preview = await readFile(join(root, 'licenses', 'android-sdk-preview-license'), 'utf8')
    expect(preview).toContain(ANDROID_SDK_LICENSE_HASHES[2])
    // detectSdk 的 licensed 判据与写入对齐
    expect((await detectSdk(root)).licensed).toBe(true)
  })

  it('自定义文件表按传入内容写', async () => {
    const root = await makeTmp()
    await writeLicenseFiles(root, { 'android-sdk-license': 'abc' })
    expect(await readFile(join(root, 'licenses', 'android-sdk-license'), 'utf8')).toBe('abc\n')
  })
})

describe('parseSdkManagerPercent', () => {
  it('识别进度行', () => {
    expect(
      parseSdkManagerPercent('[=======================================] 100% Preparing SDK')
    ).toBe(100)
    expect(parseSdkManagerPercent('[===  12%] Unpacking…')).toBe(12)
    expect(parseSdkManagerPercent('  0% Computing updates')).toBe(0)
  })

  it('非进度行与越界值返回 undefined', () => {
    expect(parseSdkManagerPercent('Loading local repository...')).toBeUndefined()
    expect(parseSdkManagerPercent('[1 200%] bad')).toBeUndefined()
  })
})

describe('bootstrapSdk（注入 fake 依赖）', () => {
  it('全缺 → 按 5 步序列补齐，无中间状态泄漏', async () => {
    const root = await makeTmp()
    const progresses: string[] = []
    const unpacked: string[] = []
    const result = await bootstrapSdk(
      root,
      {
        sources: {
          jreUrl: 'https://fake/jre.tar.gz',
          jreSha256: sha256('jre-archive'),
          cmdlineToolsUrl: 'https://fake/ct.zip',
          cmdlineToolsSha1: sha1('cmdline-archive')
        },
        fetcher: async (url) => {
          if (url.includes('jre')) return Buffer.from('jre-archive')
          return Buffer.from('cmdline-archive')
        },
        unpacker: async (_archive, dest) => {
          unpacked.push(dest)
          // 模拟 JRE tar 结构与 cmdline-tools zip 结构
          if (dest.endsWith('.tmp-jre')) {
            await mkdir(join(dest, 'jdk-21-jre', 'Contents', 'Home', 'bin'), { recursive: true })
            await writeFile(join(dest, 'jdk-21-jre', 'Contents', 'Home', 'bin', 'java'), '', 'utf8')
          } else {
            await mkdir(join(dest, 'cmdline-tools', 'bin'), { recursive: true })
            await writeFile(join(dest, 'cmdline-tools', 'bin', 'sdkmanager'), '', 'utf8')
          }
        },
        runner: async (r, packages, onPercent) => {
          onPercent(50)
          for (const pkg of packages) {
            const dir = join(r, pkg)
            await mkdir(dir, { recursive: true })
            await writeFile(join(dir, pkg === 'platform-tools' ? 'adb' : 'emulator'), '', 'utf8')
            await writeSourceProps(dir, '1.0')
          }
        }
      },
      (progress) => progresses.push(progress.stage)
    )
    // 同一 stage 可能发多条（开始/解压/进度），唯一化后仍须按序齐全
    expect([...new Set(progresses)]).toEqual([
      'licenses',
      'jre',
      'cmdline-tools',
      'platform-tools',
      'emulator',
      'done'
    ])
    expect(result.licensed).toBe(true)
    expect(result.jre.present).toBe(true)
    expect(result.cmdlineTools.present).toBe(true)
    expect(result.platformTools.present).toBe(true)
    expect(result.emulator.present).toBe(true)
    // 临时目录不残留
    await expect(readFile(join(root, '.tmp-jre'))).rejects.toThrow()
  })

  it('已就绪 = no-op 且直接返回快照', async () => {
    const root = await makeTmp()
    await writeLicenseFiles(root)
    for (const [file, dir] of [
      ['java', 'jre/Contents/Home/bin'],
      ['sdkmanager', 'cmdline-tools/latest/bin'],
      ['adb', 'platform-tools'],
      ['emulator', 'emulator']
    ] as const) {
      await mkdir(join(root, dir), { recursive: true })
      await writeFile(join(root, dir, file), '', 'utf8')
    }
    const onProgress = vi.fn()
    const result = await bootstrapSdk(root, { fetcher: vi.fn() }, onProgress)
    expect(result.emulator.present).toBe(true)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'done', percent: 100 })
    )
  })
})

describe('sdkPaths（平台分支）', () => {
  it('darwin 返回值与历史布局逐字节一致（mac 零回归钉住）', () => {
    expect(sdkPaths('/sdk', 'darwin')).toEqual({
      root: '/sdk',
      jreHome: '/sdk/jre/Contents/Home',
      javaBin: '/sdk/jre/Contents/Home/bin/java',
      cmdlineToolsMarker: '/sdk/cmdline-tools/latest/bin/sdkmanager',
      sdkmanagerBin: '/sdk/cmdline-tools/latest/bin/sdkmanager',
      avdmanagerBin: '/sdk/cmdline-tools/latest/bin/avdmanager',
      adbBin: '/sdk/platform-tools/adb',
      emulatorBin: '/sdk/emulator/emulator',
      licensesDir: '/sdk/licenses'
    })
  })

  it('win32 二进制带 .exe/.bat 后缀、JRE 无 Contents/Home 层', () => {
    const paths = sdkPaths('/sdk', 'win32')
    expect(paths.jreHome).toBe('/sdk/jre')
    expect(paths.javaBin).toBe('/sdk/jre/bin/java.exe')
    expect(paths.sdkmanagerBin).toBe('/sdk/cmdline-tools/latest/bin/sdkmanager.bat')
    expect(paths.cmdlineToolsMarker).toBe(paths.sdkmanagerBin)
    expect(paths.avdmanagerBin).toBe('/sdk/cmdline-tools/latest/bin/avdmanager.bat')
    expect(paths.adbBin).toBe('/sdk/platform-tools/adb.exe')
    expect(paths.emulatorBin).toBe('/sdk/emulator/emulator.exe')
  })
})

describe('detectSdk（win32 布局）', () => {
  it('win32 特征路径（java.exe / sdkmanager.bat / adb.exe）探测', async () => {
    const root = await makeTmp()
    await mkdir(join(root, 'jre', 'bin'), { recursive: true })
    await writeFile(join(root, 'jre', 'bin', 'java.exe'), '', 'utf8')
    await mkdir(join(root, 'cmdline-tools', 'latest', 'bin'), { recursive: true })
    await writeFile(join(root, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'), '', 'utf8')
    await mkdir(join(root, 'platform-tools'), { recursive: true })
    await writeFile(join(root, 'platform-tools', 'adb.exe'), '', 'utf8')
    const snapshot = await detectSdk(root, 'win32')
    expect(snapshot.jre.present).toBe(true)
    expect(snapshot.cmdlineTools.present).toBe(true)
    expect(snapshot.platformTools.present).toBe(true)
    expect(snapshot.platformTools.version).toBeUndefined()
    expect(snapshot.emulator.present).toBe(false)
  })

  it('同一目录按 darwin 布局探测不到（win32 分支真的换了特征名）', async () => {
    const root = await makeTmp()
    await mkdir(join(root, 'jre', 'bin'), { recursive: true })
    await writeFile(join(root, 'jre', 'bin', 'java.exe'), '', 'utf8')
    const darwinSnapshot = await detectSdk(root, 'darwin')
    expect(darwinSnapshot.jre.present).toBe(false)
  })
})

describe('bootstrapSdk（win32 分支）', () => {
  it('占位钉版源：默认源走到即抛错（禁止带占位值真跑）', async () => {
    const root = await makeTmp()
    await expect(bootstrapSdk(root, { platform: 'win32' })).rejects.toThrow('尚未钉版')
  })

  it('win32 全流程（假源）：JRE zip 顶层即 jre 根，产物按 win32 布局落位', async () => {
    const root = await makeTmp()
    const result = await bootstrapSdk(root, {
      platform: 'win32',
      sources: {
        jreUrl: 'https://fake/jre.zip',
        jreSha256: sha256('jre-win'),
        cmdlineToolsUrl: 'https://fake/ct.zip',
        cmdlineToolsSha1: sha1('ct-win')
      },
      fetcher: async (url) => Buffer.from(url.includes('jre') ? 'jre-win' : 'ct-win'),
      unpacker: async (_archive, dest) => {
        if (dest.endsWith('.tmp-jre')) {
          // Temurin win zip 顶层：<version>-jre/（bin 在内，无 macOS 的 Contents 层）
          await mkdir(join(dest, 'jdk-21.0.12.1+1-jre', 'bin'), { recursive: true })
          await writeFile(join(dest, 'jdk-21.0.12.1+1-jre', 'bin', 'java.exe'), '', 'utf8')
        } else {
          await mkdir(join(dest, 'cmdline-tools', 'bin'), { recursive: true })
          await writeFile(join(dest, 'cmdline-tools', 'bin', 'sdkmanager.bat'), '', 'utf8')
        }
      },
      runner: async (r, packages) => {
        for (const pkg of packages) {
          const dir = join(r, pkg)
          await mkdir(dir, { recursive: true })
          await writeFile(
            join(dir, pkg === 'platform-tools' ? 'adb.exe' : 'emulator.exe'),
            '',
            'utf8'
          )
          await writeSourceProps(dir, '1.0')
        }
      }
    })
    expect(result.jre.present).toBe(true)
    expect(result.cmdlineTools.present).toBe(true)
    expect(result.platformTools.present).toBe(true)
    expect(result.emulator.present).toBe(true)
    // win32 JRE 归位形态：<root>/jre/bin/java.exe（整目录 rename，无 Contents 层）
    await expect(readFile(join(root, 'jre', 'bin', 'java.exe'), 'utf8')).resolves.toBe('')
    // 临时目录不残留
    await expect(readFile(join(root, '.tmp-jre'))).rejects.toThrow()
  })
})
