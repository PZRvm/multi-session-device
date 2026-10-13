// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { AdbRunResult } from '../../emulator/adb'
import { registerApkInstallIpc } from '..'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  run: vi.fn(),
  serialOf: vi.fn<(id: string) => string>(() => 'emulator-5554'),
  adbPath: vi.fn((): string => '/sdk/platform-tools/adb')
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: (): [] => [] },
  app: { getPath: vi.fn((): string => '/userdata') }
}))

const MAIN_SENDER = { sender: { id: 7 } }
const OTHER_SENDER = { sender: { id: 9 } }

/** 注册并取回 apkInstall handler（真实 locale——断言 zh-CN 缺省文案） */
const handlerFor = (): ((event: unknown, raw: unknown) => Promise<unknown>) => {
  mocks.handle.mockClear()
  registerApkInstallIpc({
    adbPath: mocks.adbPath,
    serialOf: mocks.serialOf,
    isMainSender: (sender) => sender.id === MAIN_SENDER.sender.id,
    run: mocks.run as unknown as typeof import('../../emulator/adb').runAdb
  })
  const call = mocks.handle.mock.calls.find(([name]) => name === IPC_CHANNELS.apkInstall)
  if (!call) throw new Error('handler 未注册')
  return call[1] as (event: unknown, raw: unknown) => Promise<unknown>
}

const adbResult = (overrides: Partial<AdbRunResult> = {}): AdbRunResult => ({
  code: 0,
  stdout: 'Success\n',
  stderr: '',
  ...overrides
})

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((ok) => {
    resolve = ok
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.serialOf.mockImplementation(() => 'emulator-5554')
  mocks.adbPath.mockImplementation(() => '/sdk/platform-tools/adb')
})

describe('apkInstall 通道守卫', () => {
  it('非主窗 sender 拒绝', async () => {
    const handler = handlerFor()
    await expect(handler(OTHER_SENDER, { deviceId: 'd1', filePath: '/x/a.apk' })).rejects.toThrow(
      'apk:install'
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('非法载荷拒绝', async () => {
    const handler = handlerFor()
    await expect(handler(MAIN_SENDER, { deviceId: '', filePath: '/x/a.apk' })).rejects.toThrow(
      'apk:install'
    )
    await expect(handler(MAIN_SENDER, null)).rejects.toThrow('apk:install')
    await expect(handler(MAIN_SENDER, { deviceId: 'd1' })).rejects.toThrow('apk:install')
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('非 .apk 后缀：main 侧兜底拒绝（不依赖 renderer 守卫），不启动 adb', async () => {
    const handler = handlerFor()
    await expect(handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.txt' })).rejects.toThrow(
      'APK 安装失败：文件不是有效的 APK'
    )
    await expect(handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/app' })).rejects.toThrow(
      '文件不是有效的 APK'
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('.APK 大写后缀放行（大小写不敏感）', async () => {
    const handler = handlerFor()
    mocks.run.mockResolvedValue(adbResult())
    await expect(handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.APK' })).resolves.toEqual({
      ok: true,
      fileName: 'a.APK'
    })
    expect(mocks.run).toHaveBeenCalledWith(
      '/sdk/platform-tools/adb',
      ['-s', 'emulator-5554', 'install', '-r', '/x/a.APK'],
      { timeoutMs: 0 }
    )
  })

  it('设备未 running：serialOf 抛错直通，不启动 adb', async () => {
    const handler = handlerFor()
    mocks.serialOf.mockImplementation(() => {
      throw new Error('设备未运行，无法安装 APK')
    })
    await expect(handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk' })).rejects.toThrow(
      '设备未运行，无法安装 APK'
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })
})

describe('apkInstall 执行', () => {
  it('成功：-s serial install -r，无硬超时，返回判别联合 ok 变体', async () => {
    const handler = handlerFor()
    mocks.run.mockResolvedValue(adbResult())
    await expect(
      handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/app.debug.apk' })
    ).resolves.toEqual({ ok: true, fileName: 'app.debug.apk' })
    expect(mocks.run).toHaveBeenCalledWith(
      '/sdk/platform-tools/adb',
      ['-s', 'emulator-5554', 'install', '-r', '/x/app.debug.apk'],
      { timeoutMs: 0 }
    )
  })

  it('「仍要安装」链路：allowLowTargetSdk 时插入 bypass 旗标', async () => {
    const handler = handlerFor()
    mocks.run.mockResolvedValue(adbResult())
    await expect(
      handler(MAIN_SENDER, {
        deviceId: 'd1',
        filePath: '/x/old.apk',
        allowLowTargetSdk: true
      })
    ).resolves.toEqual({ ok: true, fileName: 'old.apk' })
    expect(mocks.run).toHaveBeenCalledWith(
      '/sdk/platform-tools/adb',
      ['-s', 'emulator-5554', 'install', '--bypass-low-target-sdk-block', '-r', '/x/old.apk'],
      { timeoutMs: 0 }
    )
  })

  it('allowLowTargetSdk 非布尔：载荷拒绝', async () => {
    const handler = handlerFor()
    await expect(
      handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk', allowLowTargetSdk: 'yes' })
    ).rejects.toThrow('apk:install')
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('同设备串行：安装中再入直接拒绝，完成后可再装', async () => {
    const handler = handlerFor()
    const gate = deferred<AdbRunResult>()
    mocks.run.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(adbResult())
    const first = handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk' })
    await expect(handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/b.apk' })).rejects.toThrow(
      '正在安装另一个 APK'
    )
    gate.resolve(adbResult())
    await expect(first).resolves.toEqual({ ok: true, fileName: 'a.apk' })
    await expect(handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/b.apk' })).resolves.toEqual({
      ok: true,
      fileName: 'b.apk'
    })
  })

  it('不同设备互不影响', async () => {
    const handler = handlerFor()
    const gate = deferred<AdbRunResult>()
    mocks.serialOf.mockImplementation((id) => (id === 'd1' ? 'emulator-5554' : 'emulator-5556'))
    mocks.run.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(adbResult())
    const first = handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk' })
    await expect(handler(MAIN_SENDER, { deviceId: 'd2', filePath: '/x/b.apk' })).resolves.toEqual({
      ok: true,
      fileName: 'b.apk'
    })
    gate.resolve(adbResult())
    await expect(first).resolves.toEqual({ ok: true, fileName: 'a.apk' })
  })
})

describe('apkInstall 失败映射（结果非异常；原文附详情）', () => {
  const cases: Array<{
    name: string
    result: AdbRunResult
    expectText: string
    canBypass?: boolean
  }> = [
    {
      name: '签名不一致',
      result: adbResult({ code: 1, stdout: 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]' }),
      expectText: '签名与设备上已装版本不一致'
    },
    {
      name: '空间不足',
      result: adbResult({ code: 1, stdout: 'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]' }),
      expectText: '设备存储空间不足'
    },
    {
      name: '系统版本过低',
      result: adbResult({ code: 1, stdout: 'Failure [INSTALL_FAILED_OLDER_SDK]' }),
      expectText: 'APK 要求的系统版本高于设备当前版本'
    },
    {
      name: 'testOnly 包',
      result: adbResult({ code: 1, stdout: 'Failure [INSTALL_FAILED_TEST_ONLY]' }),
      expectText: 'testOnly 包需正式签名'
    },
    {
      name: '非 APK 文件',
      result: adbResult({ code: 1, stderr: 'INSTALL_PARSE_FAILED_NOT_APK: bad file' }),
      expectText: '文件不是有效的 APK'
    },
    {
      name: 'MIUI 拦截 USB 安装',
      result: adbResult({ code: 1, stdout: 'Failure [INSTALL_FAILED_USER_RESTRICTED]' }),
      expectText: '开启「USB 安装」'
    },
    {
      name: 'Android 14+ 旧包：canBypass 置真（「仍要安装」可用）',
      result: adbResult({ code: 1, stdout: 'Failure [INSTALL_FAILED_DEPRECATED_SDK_VERSION]' }),
      expectText: 'targetSdk 低于 Android 14',
      canBypass: true
    },
    {
      name: '未命中签名走通用词条',
      result: adbResult({ code: 1, stderr: 'unknown adb error' }),
      expectText: 'APK 安装失败'
    },
    {
      name: 'exit 0 但无 Success',
      result: adbResult({ code: 0, stdout: 'Performing Streamed Install\n' }),
      expectText: 'APK 安装失败'
    }
  ]

  for (const item of cases) {
    it(item.name, async () => {
      const handler = handlerFor()
      mocks.run.mockResolvedValue(item.result)
      const call = handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk' })
      await expect(call).resolves.toMatchObject({
        ok: false,
        canBypassLowTargetSdk: item.canBypass ?? false
      })
      await expect(call).resolves.toMatchObject({
        message: expect.stringContaining(item.expectText)
      })
      // detail 保留 adb 原文（stdout/stderr 合并 trim 后为单行子串）
      const output = `${item.result.stdout}\n${item.result.stderr}`.trim()
      if (output.length > 0) {
        await expect(call).resolves.toMatchObject({
          message: expect.stringContaining(output)
        })
      }
    })
  }

  it('已带旗标仍失败（老 adb 不认旗标）：canBypass 不再置真', async () => {
    const handler = handlerFor()
    mocks.run.mockResolvedValue(
      adbResult({ code: 1, stderr: 'adb: unknown option -- bypass-low-target-sdk-block' })
    )
    await expect(
      handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk', allowLowTargetSdk: true })
    ).resolves.toEqual({
      ok: false,
      message: expect.stringContaining('unknown option'),
      canBypassLowTargetSdk: false
    })
  })

  it('失败详情兜底 exit 码', async () => {
    const handler = handlerFor()
    mocks.run.mockResolvedValue(adbResult({ code: 137, stdout: '', stderr: '' }))
    await expect(
      handler(MAIN_SENDER, { deviceId: 'd1', filePath: '/x/a.apk' })
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining('exit 137') })
  })
})
