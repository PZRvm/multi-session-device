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
  writeLicenseFiles,
  ANDROID_SDK_LICENSE_HASHES
} from '../sdk'
import { createHash } from 'node:crypto'
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
