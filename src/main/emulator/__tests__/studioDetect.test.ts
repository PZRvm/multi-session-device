// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  detectStudioAndSdk,
  getStudioDetection,
  isStudioSdk,
  resetStudioDetectionForTest,
  runStudioDetection,
  type StudioDetectDeps
} from '../studioDetect'

const HOME = '/Users/tester'

interface FsShape {
  dirs?: Record<string, string[]> // 目录 → 子项
  files?: Record<string, string> // 文件 → 内容
  exists?: string[] // 存在的文件（platform-tools/adb 等探测点）
}

/** 按形状表构造接缝：目录列举 / 文件读 / 存在探测 */
const fsDeps = (shape: FsShape): StudioDetectDeps => ({
  listDir: async (path) => shape.dirs?.[path] ?? [],
  readFile: async (path) => {
    const content = shape.files?.[path]
    if (content === undefined) throw new Error(`ENOENT ${path}`)
    return content
  },
  fileExists: async (path) =>
    (shape.exists?.includes(path) ?? false) || shape.files?.[path] !== undefined,
  homedir: () => HOME,
  env: {},
  mdfind: async () => [],
  adbOnPath: async () => null
})

const SDK = `${HOME}/Library/Android/sdk`
const STUDIO = '/Applications/Android Studio.app'
const sdkShape = (over: Partial<FsShape> = {}): FsShape => ({
  dirs: {
    '/Applications': ['Android Studio.app', 'Safari.app'],
    [`${HOME}/Library/Application Support/Google`]: [],
    ...over.dirs
  },
  exists: [`${SDK}/platform-tools/adb`, `${STUDIO}/Contents/jbr/Contents/Home/bin/java`],
  ...over
})

describe('detectStudioAndSdk（检测链）', () => {
  beforeEach(() => {
    resetStudioDetectionForTest()
  })

  it('Studio 本体：/Applications 扫描命中 + JBR java 在场才产出 jbrHome', async () => {
    const result = await detectStudioAndSdk(fsDeps(sdkShape()))
    expect(result.studioFound).toBe(true)
    expect(result.studioAppPath).toBe(STUDIO)
    expect(result.jbrHome).toBe(`${STUDIO}/Contents/jbr/Contents/Home`)
  })

  it('Studio 未装：目录扫描与 mdfind 均无果 → studioFound=false、无 JBR、候选链照走', async () => {
    const result = await detectStudioAndSdk(
      fsDeps({ dirs: { '/Applications': ['Safari.app'] }, exists: [`${SDK}/platform-tools/adb`] })
    )
    expect(result.studioFound).toBe(false)
    expect(result.studioAppPath).toBeNull()
    expect(result.jbrHome).toBeNull()
    expect(result.sdkCandidate).toBe(SDK)
    expect(result.candidateSource).toBe('default-dir')
  })

  it('mdfind 兜底：目录扫描无果时 Spotlight 结果采纳首个 .app', async () => {
    const result = await detectStudioAndSdk({
      ...fsDeps({ exists: [`${SDK}/platform-tools/adb`] }),
      mdfind: async () => ['/private/var/folders/x/Android Studio.app', '']
    })
    expect(result.studioFound).toBe(true)
    expect(result.studioAppPath).toBe('/private/var/folders/x/Android Studio.app')
  })

  it('候选链 1：Studio 配置文件（含 $USER_HOME$ 宏展开）优先于其他级', async () => {
    const configDir = `${HOME}/Library/Application Support/Google/AndroidStudio2025.1/options`
    const result = await detectStudioAndSdk(
      fsDeps(
        sdkShape({
          dirs: {
            '/Applications': ['Android Studio.app'],
            [`${HOME}/Library/Application Support/Google`]: [
              'AndroidStudio2024.3',
              'AndroidStudio2025.1'
            ],
            [`${HOME}/Library/Application Support/Google/AndroidStudio2025.1/options`]: [
              'other.xml'
            ]
          },
          files: {
            [`${configDir}/other.xml`]: `
              <component name="AndroidSdkService"><option name="sdkPath" value="$USER_HOME$/sdks/android" /></component>
            `
          },
          exists: [
            `${HOME}/sdks/android/platform-tools/adb`,
            `${STUDIO}/Contents/jbr/Contents/Home/bin/java`
          ]
        })
      )
    )
    expect(result.sdkCandidate).toBe(`${HOME}/sdks/android`)
    expect(result.candidateSource).toBe('studio-config')
  })

  it('候选链按版本号从新到旧试配置目录；新版路径未核验时回落旧版核验通过者', async () => {
    const oldDir = `${HOME}/Library/Application Support/Google/AndroidStudio2024.3/options`
    const result = await detectStudioAndSdk(
      fsDeps(
        sdkShape({
          dirs: {
            '/Applications': ['Android Studio.app'],
            [`${HOME}/Library/Application Support/Google`]: [
              'AndroidStudio2024.3',
              'AndroidStudio2025.1'
            ],
            [`${HOME}/Library/Application Support/Google/AndroidStudio2024.3/options`]: [
              'other.xml'
            ],
            [`${HOME}/Library/Application Support/Google/AndroidStudio2025.1/options`]: [
              'other.xml'
            ]
          },
          files: {
            // 新版配置里的路径没有 platform-tools（未核验）——不采纳，落旧版配置
            [`${HOME}/Library/Application Support/Google/AndroidStudio2025.1/options/other.xml`]:
              '<option name="sdkPath" value="/not-a-sdk" />',
            [`${oldDir}/other.xml`]: `<option name="sdkPath" value="${SDK}" />`
          },
          exists: [`${SDK}/platform-tools/adb`, `${STUDIO}/Contents/jbr/Contents/Home/bin/java`]
        })
      )
    )
    expect(result.sdkCandidate).toBe(SDK)
    expect(result.candidateSource).toBe('studio-config')
  })

  it('候选链 2/3：环境变量优先于默认目录；两者都核验才采纳', async () => {
    const envResult = await detectStudioAndSdk({
      ...fsDeps(
        sdkShape({
          exists: [
            '/opt/sdk/licenses/android-sdk-license',
            `${STUDIO}/Contents/jbr/Contents/Home/bin/java`
          ]
        })
      ),
      env: { ANDROID_SDK_ROOT: '/opt/sdk' }
    })
    expect(envResult.sdkCandidate).toBe('/opt/sdk')
    expect(envResult.candidateSource).toBe('env')

    const defaultResult = await detectStudioAndSdk(fsDeps(sdkShape()))
    expect(defaultResult.sdkCandidate).toBe(SDK)
    expect(defaultResult.candidateSource).toBe('default-dir')
  })

  it('候选链 4：PATH 上 adb 反推（adb 上溯两级核验）', async () => {
    const result = await detectStudioAndSdk({
      ...fsDeps(
        sdkShape({
          exists: [`${STUDIO}/Contents/jbr/Contents/Home/bin/java`, '/opt/alt/platform-tools/adb']
        })
      ),
      adbOnPath: async () => '/opt/alt/platform-tools/adb'
    })
    expect(result.sdkCandidate).toBe('/opt/alt')
    expect(result.candidateSource).toBe('path-adb')
  })

  it('四级全空：sdkCandidate=null 但 defaultSdkPath 恒可预填', async () => {
    const result = await detectStudioAndSdk(fsDeps({}))
    expect(result.sdkCandidate).toBeNull()
    expect(result.candidateSource).toBeNull()
    expect(result.defaultSdkPath).toBe(SDK)
  })

  it('JBR 缺 bin/java：studioFound 仍真，jbrHome=null（消费方按缺件报错）', async () => {
    const result = await detectStudioAndSdk(
      fsDeps({ dirs: { '/Applications': ['Android Studio.app'] }, exists: [] })
    )
    expect(result.studioFound).toBe(true)
    expect(result.jbrHome).toBeNull()
  })
})

describe('isStudioSdk（归属判定）', () => {
  it('realpath 相等即同一 SDK；候选缺失或路径不存在为 false', async () => {
    const detection = {
      studioFound: true,
      studioAppPath: STUDIO,
      jbrHome: null,
      sdkCandidate: SDK,
      candidateSource: 'default-dir' as const,
      defaultSdkPath: SDK
    }
    expect(await isStudioSdk(SDK, detection, { realpathFn: async () => '/real/sdk' })).toBe(true)
    expect(
      await isStudioSdk('/linked-sdk', detection, {
        realpathFn: async (p) => (p === SDK ? '/real/sdk' : '/real/sdk')
      })
    ).toBe(true)
    expect(
      await isStudioSdk('/other', detection, {
        realpathFn: async (p) => (p === SDK ? '/real/sdk' : '/elsewhere')
      })
    ).toBe(false)
    expect(await isStudioSdk('/other', null)).toBe(false)
    const throws = {
      realpathFn: async () => {
        throw new Error('ENOENT')
      }
    }
    expect(await isStudioSdk('/gone', detection, throws)).toBe(false)
  })
})

describe('检测缓存', () => {
  beforeEach(() => {
    resetStudioDetectionForTest()
  })

  it('runStudioDetection 写缓存，getStudioDetection 读缓存', async () => {
    expect(getStudioDetection()).toBeNull()
    const spy = vi.spyOn({ detectStudioAndSdk }, 'detectStudioAndSdk')
    // 直接驱动真实实现（不经 spy 分支）：run → cache 生效
    spy.mockRestore()
    const result = await runStudioDetection(fsDeps(sdkShape()))
    expect(result).toEqual(getStudioDetection())
    expect(getStudioDetection()?.studioFound).toBe(true)
  })
})
