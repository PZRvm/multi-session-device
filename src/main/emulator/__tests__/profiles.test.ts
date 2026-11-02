// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { avdmanagerPathFor, parseAvdDeviceEntries, listDeviceProfiles } from '../profiles'
import { type RawProfileMeta, parseDeviceXml } from '../profileMetadata'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

/** 节选自 avdmanager list device 真实输出（cmdline-tools 23，本机） */
const FIXTURE = `Available devices definitions:
id: 0 or "ai_glasses_device"
    Name: AI Glasses
    OEM : Google
    Tag : ai-glasses
---------
id: 3 or "automotive_1024p_landscape"
    Name: Automotive (1024p landscape)
    OEM : Google
    Tag : android-automotive-playstore
---------
id: 43 or "pixel_8"
    Name: Pixel 8
    OEM : Google
---------
id: 44 or "pixel_8_pro"
    Name: Pixel 8 Pro
    OEM : Google
---------
id: 90 or "pixel_tablet"
    Name: Pixel Tablet
    OEM : Google
---------
id: 36 or "medium_phone"
    Name: Medium Phone
    OEM : Google
---------`

describe('parseAvdDeviceEntries', () => {
  it('提取 id/Name/OEM/Tag——带 Tag 的 wear/tv/automotive 不再被剔除', () => {
    const entries = parseAvdDeviceEntries(FIXTURE)
    expect(entries.map((entry) => entry.id)).toEqual([
      'ai_glasses_device',
      'automotive_1024p_landscape',
      'pixel_8',
      'pixel_8_pro',
      'pixel_tablet',
      'medium_phone'
    ])
    expect(entries[0]).toEqual({
      id: 'ai_glasses_device',
      name: 'AI Glasses',
      oem: 'Google',
      tagId: 'ai-glasses'
    })
    expect(entries[2]).toEqual({ id: 'pixel_8', name: 'Pixel 8', oem: 'Google', tagId: null })
  })

  it('坏块（缺 id 或 Name）跳过；空输出返回空数组', () => {
    expect(parseAvdDeviceEntries('Available devices definitions:\n---------')).toEqual([])
    expect(parseAvdDeviceEntries('id: 1 or "x"\n    Name: X\n')).toEqual([
      { id: 'x', name: 'X', oem: null, tagId: null }
    ])
  })
})

const fixtureDir = join(__dirname, 'fixtures')
const readDeviceXml = (name: string): string =>
  readFileSync(join(fixtureDir, 'devices-xml', name), 'utf8')

/** 用 nexus.xml 的 pixel_8 元数据当作注入源，验证组合逻辑 */
const PIXEL_8_META: RawProfileMeta[] = parseDeviceXml(readDeviceXml('nexus.xml')).filter(
  (meta) => meta.id === 'pixel_8'
)

describe('listDeviceProfiles（avdmanager 输出 + jar 元数据关联）', () => {
  it('双方都有 → 富元数据 + creatable；仅 avdmanager → 贫元数据 creatable；仅 XML → 不可创建', async () => {
    const profiles = await listDeviceProfiles({
      sdkRoot: '/unused-sdk',
      avdmanagerPath: '/unused',
      runner: async () => FIXTURE,
      metaSource: () => [
        ...PIXEL_8_META,
        // XML 独有：不在 avdmanager 输出中 → 展示但不可创建
        { ...PIXEL_8_META[0], id: 'xml_only_device', name: 'Xml Only' }
      ]
    })
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))

    const pixel8 = byId.get('pixel_8')
    expect(pixel8?.creatable).toBe(true)
    expect(pixel8?.manufacturer).toBe('Google')
    expect(pixel8?.screen.widthPx).toBe(1080)
    expect(pixel8?.formFactor).toBe('phone')

    // avdmanager 独有：元数据缺失但不猜
    const automotive = byId.get('automotive_1024p_landscape')
    expect(automotive?.creatable).toBe(true)
    expect(automotive?.formFactor).toBe('automotive')
    expect(automotive?.screen.diagonalInches).toBeNull()

    // ai-glasses：未知标签 → unknown，不塞进手机
    expect(byId.get('ai_glasses_device')?.formFactor).toBe('unknown')

    // XML 独有：可展示、不可创建
    const xmlOnly = byId.get('xml_only_device')
    expect(xmlOnly?.creatable).toBe(false)
    expect(xmlOnly?.screen.widthPx).toBe(1080)
  })

  it('metaSource 缺省时走 adm-zip 读 jar（缺 jar 降级为 avd-only）', async () => {
    const profiles = await listDeviceProfiles({
      sdkRoot: '/unused-sdk',
      avdmanagerPath: '/unused/avdmanager',
      jarPath: join(fixtureDir, 'no-such.jar'),
      runner: async () => FIXTURE
    })
    expect(profiles).toHaveLength(6)
    expect(profiles.every((profile) => profile.screen.widthPx === null)).toBe(true)
    expect(profiles.every((profile) => profile.creatable)).toBe(true)
  })
})

describe('listDeviceProfiles 默认子进程（自带 Java，不依赖宿主安装）', () => {
  // 夹具按平台落形态：win32 是 avdmanager.bat（cmd.exe 剧本）+ java.exe 占位过 X_OK 探测；
  // darwin 维持原 shell 脚本逐字节不变
  const WIN = process.platform === 'win32'
  const tempRoots: string[] = []

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const makeSdk = async (): Promise<{
    sdkRoot: string
    javaBin: string
    avdmanager: string
    envFile: string
  }> => {
    const root = await mkdtemp(join(tmpdir(), 'msd-profile-java-'))
    tempRoots.push(root)
    const sdkRoot = join(root, 'SDK path with spaces')
    const javaBin = WIN
      ? join(sdkRoot, 'jre', 'bin', 'java.exe')
      : join(sdkRoot, 'jre', 'Contents', 'Home', 'bin', 'java')
    const envFile = join(sdkRoot, 'observed-environment.txt')
    const avdmanager = avdmanagerPathFor(sdkRoot)
    await mkdir(join(javaBin, '..'), { recursive: true })
    await mkdir(join(avdmanager, '..'), { recursive: true })
    if (WIN) {
      await writeFile(javaBin, '')
      await writeFile(
        avdmanager,
        [
          '@echo off',
          'if not "%~1"=="list" exit /b 23',
          'if not "%~2"=="device" exit /b 23',
          '>"%ANDROID_SDK_ROOT%\\observed-environment.txt" echo %JAVA_HOME%',
          '>>"%ANDROID_SDK_ROOT%\\observed-environment.txt" echo %ANDROID_SDK_ROOT%',
          '>>"%ANDROID_SDK_ROOT%\\observed-environment.txt" echo %ANDROID_HOME%',
          '>>"%ANDROID_SDK_ROOT%\\observed-environment.txt" echo %ANDROID_USER_HOME%',
          '>>"%ANDROID_SDK_ROOT%\\observed-environment.txt" echo %ANDROID_EMULATOR_HOME%',
          '>>"%ANDROID_SDK_ROOT%\\observed-environment.txt" echo %ANDROID_AVD_HOME%',
          'echo id: 43 or "pixel_8"',
          'echo Name: Pixel 8',
          'echo OEM : Google'
        ].join('\r\n')
      )
    } else {
      await writeFile(
        avdmanager,
        '#!/bin/sh\n[ "$1" = list ] && [ "$2" = device ] || exit 23\nexec "$JAVA_HOME/bin/java"\n',
        { mode: 0o755 }
      )
      await writeFile(
        javaBin,
        `#!/bin/sh\nprintf '%s\\n' "$JAVA_HOME" "$ANDROID_SDK_ROOT" "$ANDROID_HOME" "$ANDROID_USER_HOME" "$ANDROID_EMULATOR_HOME" "$ANDROID_AVD_HOME" > "$ANDROID_SDK_ROOT/observed-environment.txt"\nprintf '%s\\n' 'id: 43 or "pixel_8"' '    Name: Pixel 8' '    OEM : Google'\n`,
        { mode: 0o755 }
      )
    }
    return { sdkRoot, javaBin, avdmanager, envFile }
  }

  it.each([undefined, '/wrong/host-jdk'])(
    'PATH 无 Java、宿主 JAVA_HOME=%s 时仍枚举，SDK 路径含空格',
    async (hostJava) => {
      const { sdkRoot, envFile } = await makeSdk()
      // 「PATH 无 Java」剧本：win32 下 PATH 只留 System32（无 java，但 cmd.exe 可解析——
      // libuv 找裸命令只搜 cwd 与 PATH，不留 System32 会连 cmd.exe 一起 ENOENT）
      const stubPath = WIN
        ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
        : '/no-host-programs'
      vi.stubEnv('JAVA_HOME', hostJava)
      vi.stubEnv('PATH', stubPath)
      vi.stubEnv('ANDROID_USER_HOME', '/wrong/android-user')
      vi.stubEnv('ANDROID_EMULATOR_HOME', '/wrong/emulator-home')
      vi.stubEnv('ANDROID_AVD_HOME', '/wrong/avds')
      const profiles = await listDeviceProfiles({
        sdkRoot,
        avdmanagerPath: avdmanagerPathFor(sdkRoot),
        metaSource: () => PIXEL_8_META
      })
      expect(profiles).toHaveLength(1)
      expect(profiles[0]).toMatchObject({ id: 'pixel_8', creatable: true, ramMiB: 7562 })
      // cmd 的 echo 落 CRLF，拆行容忍 \r（darwin 脚本为 \n，正则两态兼容）
      expect((await readFile(envFile, 'utf8')).trim().split(/\r?\n/)).toEqual([
        WIN ? join(sdkRoot, 'jre') : join(sdkRoot, 'jre', 'Contents', 'Home'),
        sdkRoot,
        sdkRoot,
        join(sdkRoot, 'android-user'),
        join(sdkRoot, 'android-user'),
        join(sdkRoot, 'android-user', 'avd')
      ])
      expect(process.env.JAVA_HOME).toBe(hostJava)
      expect(process.env.PATH).toBe(stubPath)
      expect(process.env.ANDROID_USER_HOME).toBe('/wrong/android-user')
    }
  )

  it('自带 Java missing：明确提示修复 SDK/JRE，不能依赖宿主回退', async () => {
    const { sdkRoot, javaBin, envFile } = await makeSdk()
    await rm(javaBin)
    vi.stubEnv('JAVA_HOME', '/host-jdk')
    await expect(
      listDeviceProfiles({ sdkRoot, avdmanagerPath: avdmanagerPathFor(sdkRoot) })
    ).rejects.toThrow(/SDK.*JRE.*修复/)
    await expect(readFile(envFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  // not-executable 是 POSIX 执行位形态——win32 无执行位（X_OK 只看在场），无对应剧本
  it.skipIf(process.platform === 'win32')(
    '自带 Java not-executable：明确提示修复 SDK/JRE，不能依赖宿主回退',
    async () => {
      const { sdkRoot, javaBin, envFile } = await makeSdk()
      await chmod(javaBin, 0o644)
      vi.stubEnv('JAVA_HOME', '/host-jdk')
      await expect(
        listDeviceProfiles({ sdkRoot, avdmanagerPath: avdmanagerPathFor(sdkRoot) })
      ).rejects.toThrow(/SDK.*JRE.*修复/)
      await expect(readFile(envFile)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('自带 Java 执行失败：保留 stdout 中的错误原因，并提示修复 SDK/JRE', async () => {
    const { sdkRoot, javaBin, avdmanager } = await makeSdk()
    if (WIN) {
      // win 剧本：失败发生在 bat 本身（java.exe 占位不参与执行）
      await writeFile(avdmanager, '@echo off\r\necho broken JRE runtime\r\nexit /b 17\r\n')
    } else {
      await writeFile(javaBin, '#!/bin/sh\nprintf "broken JRE runtime\n"\nexit 17\n', {
        mode: 0o755
      })
    }
    await expect(
      listDeviceProfiles({ sdkRoot, avdmanagerPath: avdmanagerPathFor(sdkRoot) })
    ).rejects.toThrow(/SDK.*JRE.*修复.*exit 17.*broken JRE runtime/)
  })
})
