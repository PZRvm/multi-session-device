// @vitest-environment node
import { join } from 'node:path'
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

describe('detectStudioAndSdk（win32 分支——plan 2026-10-22-windows-studio-detect）', () => {
  beforeEach(() => {
    resetStudioDetectionForTest()
  })

  // 路径常量经 join 构造：在 posix 测试机上产生确定性的混合分隔符串，
  // 与实现侧 join 的行为逐字符一致（真机 win32 上 join 输出反斜杠，同构）
  const WHOME = 'C:\\Users\\tester'
  const WSTUDIO = 'C:\\Program Files\\Android\\Android Studio'
  const WSDK = join(WHOME, 'AppData', 'Local', 'Android', 'Sdk')
  const WCONFIG_ROOT = join(WHOME, 'AppData', 'Roaming', 'Google')

  const winDeps = (shape: FsShape, over: Partial<StudioDetectDeps> = {}): StudioDetectDeps => ({
    ...fsDeps(shape),
    homedir: () => WHOME,
    platform: 'win32',
    ...over
  })

  it('Studio 本体：固定目录探测命中（bin/studio64.exe），jbr 布局无 Contents 层', async () => {
    const result = await detectStudioAndSdk(
      winDeps({
        exists: [
          join(WSTUDIO, 'bin', 'studio64.exe'),
          join(WSTUDIO, 'jbr', 'bin', 'java.exe'),
          join(WSDK, 'platform-tools', 'adb.exe')
        ]
      })
    )
    expect(result.studioFound).toBe(true)
    expect(result.studioAppPath).toBe(WSTUDIO)
    expect(result.jbrHome).toBe(join(WSTUDIO, 'jbr'))
    expect(result.sdkCandidate).toBe(WSDK)
    expect(result.candidateSource).toBe('default-dir')
  })

  it('Studio 未装：固定目录无 studio64.exe → studioFound=false；mdfind 兜底不被调用', async () => {
    const mdfind = vi.fn(async () => ['/x/Android Studio.app'])
    const result = await detectStudioAndSdk(
      winDeps({ exists: [join(WSDK, 'platform-tools', 'adb.exe')] }, { mdfind })
    )
    expect(result.studioFound).toBe(false)
    expect(result.studioAppPath).toBeNull()
    expect(mdfind).not.toHaveBeenCalled()
    expect(result.defaultSdkPath).toBe(WSDK)
    expect(result.candidateSource).toBe('default-dir')
  })

  it('候选链 1（win）：配置目录在 %APPDATA%\\Google，$USER_HOME$ 宏 + 盘符形状（反斜杠）采纳', async () => {
    const optsDir = join(WCONFIG_ROOT, 'AndroidStudio2025.1', 'options')
    const result = await detectStudioAndSdk(
      winDeps({
        dirs: { [WCONFIG_ROOT]: ['AndroidStudio2025.1'], [optsDir]: ['other.xml'] },
        files: {
          [join(optsDir, 'other.xml')]:
            '<option name="sdkPath" value="$USER_HOME$\\sdks\\android" />'
        },
        exists: [join('C:\\Users\\tester\\sdks\\android', 'platform-tools', 'adb.exe')]
      })
    )
    expect(result.sdkCandidate).toBe('C:\\Users\\tester\\sdks\\android')
    expect(result.candidateSource).toBe('studio-config')
  })

  it('候选链 1（win）：正斜杠盘符路径也收（Windows 配置文件两风格混排的现实），仍经核验', async () => {
    const optsDir = join(WCONFIG_ROOT, 'AndroidStudio2025.1', 'options')
    const result = await detectStudioAndSdk(
      winDeps({
        dirs: { [WCONFIG_ROOT]: ['AndroidStudio2025.1'], [optsDir]: ['other.xml'] },
        files: {
          [join(optsDir, 'other.xml')]: '<option name="sdkPath" value="C:/sdks/android" />'
        },
        exists: [join('C:/sdks/android', 'platform-tools', 'adb.exe')]
      })
    )
    expect(result.sdkCandidate).toBe('C:/sdks/android')
    expect(result.candidateSource).toBe('studio-config')
  })

  it('候选链 4（win）：PATH 按 ; 分隔找 adb.exe，上溯两级核验', async () => {
    // fsDeps 默认注入 adbOnPath=null 会短路分支 4——删掉该键，走 win32 默认实现
    const rest = fsDeps({ exists: [join('C:/sdkroot/platform-tools', 'adb.exe')] })
    delete rest.adbOnPath
    const result = await detectStudioAndSdk({
      ...rest,
      homedir: () => WHOME,
      platform: 'win32',
      env: { PATH: 'C:/sdkroot/platform-tools;C:/empty' }
    })
    expect(result.sdkCandidate).toBe('C:/sdkroot')
    expect(result.candidateSource).toBe('path-adb')
  })

  it('P3-2 修复：APPDATA 重定向时配置目录跟走（企业漫游/OneDrive 场景）', async () => {
    const redirectedRoot = join('D:\\Roamed', 'Google')
    const optsDir = join(redirectedRoot, 'AndroidStudio2025.1', 'options')
    const result = await detectStudioAndSdk(
      winDeps(
        {
          dirs: { [redirectedRoot]: ['AndroidStudio2025.1'], [optsDir]: ['other.xml'] },
          files: {
            [join(optsDir, 'other.xml')]: '<option name="sdkPath" value="C:/sdks/android" />'
          },
          exists: [join('C:/sdks/android', 'platform-tools', 'adb.exe')]
        },
        { env: { APPDATA: 'D:\\Roamed' } }
      )
    )
    expect(result.sdkCandidate).toBe('C:/sdks/android')
    expect(result.candidateSource).toBe('studio-config')
  })

  it('P3-2 修复：LOCALAPPDATA 重定向时默认 SDK 目录跟走；缺省仍按 homedir 推', async () => {
    const redirectedSdk = join('D:\\LocalAppData', 'Android', 'Sdk')
    const redirected = await detectStudioAndSdk(
      winDeps(
        { exists: [join(redirectedSdk, 'platform-tools', 'adb.exe')] },
        { env: { LOCALAPPDATA: 'D:\\LocalAppData' } }
      )
    )
    expect(redirected.defaultSdkPath).toBe(redirectedSdk)
    expect(redirected.sdkCandidate).toBe(redirectedSdk)
    expect(redirected.candidateSource).toBe('default-dir')
    // env 未给（fsDeps 的 env 是空对象）→ 回退 homedir 推导，win 用例其余各条已覆盖此形态
    const fallback = await detectStudioAndSdk(winDeps({}))
    expect(fallback.defaultSdkPath).toBe(WSDK)
  })
})

describe('isStudioSdk（win32 大小写规范化）', () => {
  const winDetection = {
    studioFound: true,
    studioAppPath: null,
    jbrHome: null,
    sdkCandidate: 'C:\\Users\\tester\\AppData\\Local\\Android\\Sdk',
    candidateSource: 'default-dir' as const,
    defaultSdkPath: ''
  }

  it('win32 大小写漂移直接判等，不走 realpath', async () => {
    const realpathFn = vi.fn(async (p: string) => p)
    const result = await isStudioSdk(
      'c:\\users\\tester\\appdata\\local\\android\\sdk',
      winDetection,
      {
        platform: 'win32',
        realpathFn
      }
    )
    expect(result).toBe(true)
    expect(realpathFn).not.toHaveBeenCalled()
  })

  it('win32 realpath 结果大小写漂移也判同一处；posix 比较保持大小写敏感', async () => {
    expect(
      await isStudioSdk('C:\\Linked\\Sdk', winDetection, {
        platform: 'win32',
        realpathFn: async () => 'c:\\users\\tester\\appdata\\local\\android\\sdk'
      })
    ).toBe(true)
    // posix：大小写不同且 realpath 不同 → false（darwin 行为不变）
    expect(
      await isStudioSdk(
        '/linked-sdk',
        {
          ...winDetection,
          sdkCandidate: '/real/sdk'
        },
        {
          realpathFn: async (p) => (p === '/linked-sdk' ? '/elsewhere' : '/real/sdk')
        }
      )
    ).toBe(false)
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
