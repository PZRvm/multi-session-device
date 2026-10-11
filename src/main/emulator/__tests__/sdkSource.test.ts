// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}))
const studioMocks = vi.hoisted(() => ({
  get: vi.fn<() => unknown>(() => null),
  run: vi.fn(async () => ({
    studioFound: true,
    studioAppPath: '/Applications/Android Studio.app',
    jbrHome: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    sdkCandidate: '/Users/t/Library/Android/sdk',
    candidateSource: 'default-dir',
    defaultSdkPath: '/Users/t/Library/Android/sdk'
  }))
}))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/userdata') } }))
vi.mock('node:fs/promises', () => mocks)
vi.mock('../studioDetect', () => ({
  getStudioDetection: studioMocks.get,
  runStudioDetection: studioMocks.run
}))

import {
  getSdkSourceState,
  isSharedReadOnly,
  javaBinFor,
  managedSdkRoot,
  persistSdkSourceState,
  resetSdkSourceStateForTest,
  restoreSdkSource,
  resolveSdkRoot,
  setSdkSourceState
} from '../sdkSource'

const loadWith = async (raw: string | Error): Promise<void> => {
  mocks.readFile.mockImplementationOnce(
    raw instanceof Error ? () => Promise.reject(raw) : () => Promise.resolve(raw)
  )
  await restoreSdkSource()
}

describe('sdkSource store（sdk.json）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    studioMocks.get.mockReturnValue(null)
    resetSdkSourceStateForTest()
  })

  it('无文件 = 首启缺省托管，活动根为应用数据目录 AndroidSDK', async () => {
    await loadWith(new Error('ENOENT'))
    expect(getSdkSourceState()).toEqual({
      version: 1,
      source: 'managed',
      customPath: null,
      sharedPath: null
    })
    expect(resolveSdkRoot()).toBe('/userdata/AndroidSDK')
    expect(isSharedReadOnly()).toBe(false)
  })

  it('合法文件恢复三态：custom/shared 各自解析活动根', async () => {
    await loadWith(
      JSON.stringify({ version: 1, source: 'custom', customPath: '/vol/sdk', sharedPath: null })
    )
    expect(resolveSdkRoot()).toBe('/vol/sdk')
    expect(isSharedReadOnly()).toBe(false)

    await loadWith(
      JSON.stringify({
        version: 1,
        source: 'shared-studio',
        customPath: null,
        sharedPath: '/Users/t/Library/Android/sdk'
      })
    )
    expect(resolveSdkRoot()).toBe('/Users/t/Library/Android/sdk')
    expect(isSharedReadOnly()).toBe(true)
  })

  it('损坏 JSON / 版本不匹配 / 闭集外 source 均按缺省起步且不覆写原文件', async () => {
    mocks.readFile.mockResolvedValue('not-json{{{')
    await restoreSdkSource()
    expect(getSdkSourceState().source).toBe('managed')
    expect(mocks.writeFile).not.toHaveBeenCalled()

    resetSdkSourceStateForTest()
    await loadWith(JSON.stringify({ version: 99, source: 'custom', customPath: '/x' }))
    expect(getSdkSourceState().source).toBe('managed')

    resetSdkSourceStateForTest()
    await loadWith(JSON.stringify({ version: 1, source: 'weird', customPath: '/x' }))
    expect(getSdkSourceState().source).toBe('managed')
    // 非法 source 只回落来源枚举，其余合法字段保留（上次自选路径不因单字段损坏丢失）
    expect(getSdkSourceState().customPath).toBe('/x')
    expect(resolveSdkRoot()).toBe(managedSdkRoot())
  })

  it('非法组合防御：custom/shared 但路径缺失回落托管根', async () => {
    await loadWith(JSON.stringify({ version: 1, source: 'custom', customPath: null }))
    expect(resolveSdkRoot()).toBe(managedSdkRoot())

    resetSdkSourceStateForTest()
    await loadWith(JSON.stringify({ version: 1, source: 'custom', customPath: '   ' }))
    expect(resolveSdkRoot()).toBe(managedSdkRoot())

    resetSdkSourceStateForTest()
    await loadWith(JSON.stringify({ version: 1, source: 'shared-studio', sharedPath: undefined }))
    expect(resolveSdkRoot()).toBe(managedSdkRoot())
  })

  it('内存先行 + 落盘 tmp+rename 原子替换', async () => {
    setSdkSourceState({
      version: 1,
      source: 'custom',
      customPath: '/vol/sdk',
      sharedPath: null
    })
    expect(resolveSdkRoot()).toBe('/vol/sdk')

    await persistSdkSourceState()
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    const [tmpPath, payload] = mocks.writeFile.mock.calls[0]
    expect(tmpPath).toBe('/userdata/sdk.json.tmp')
    expect(JSON.parse(payload as string)).toEqual({
      version: 1,
      source: 'custom',
      customPath: '/vol/sdk',
      sharedPath: null
    })
    expect(mocks.rename).toHaveBeenCalledWith('/userdata/sdk.json.tmp', '/userdata/sdk.json')
  })

  it('落盘串行队列：并发 persist 不交错且单次失败不断队列', async () => {
    let releaseFirst: () => void = () => undefined
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    mocks.writeFile
      .mockImplementationOnce(() => firstWrite)
      .mockImplementationOnce(() => Promise.resolve())

    setSdkSourceState({ version: 1, source: 'managed', customPath: null, sharedPath: null })
    const p1 = persistSdkSourceState()
    setSdkSourceState({
      version: 1,
      source: 'custom',
      customPath: '/vol/sdk',
      sharedPath: null
    })
    const p2 = persistSdkSourceState()

    releaseFirst()
    await Promise.all([p1, p2])
    expect(mocks.writeFile).toHaveBeenCalledTimes(2)
    // 第二次 persist 载荷是调用时快照（custom），不被第一次的 managed 覆盖
    expect(JSON.parse(mocks.writeFile.mock.calls[1][1] as string).source).toBe('custom')
  })

  it('落盘失败不抛断后续写入（队列续命）', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('disk full'))
    await expect(persistSdkSourceState()).rejects.toThrow('disk full')

    mocks.writeFile.mockImplementationOnce(() => Promise.resolve())
    await expect(persistSdkSourceState()).resolves.toBeUndefined()
  })

  it('javaBinFor 按实际运行来源出路径：managed/custom 内置 JRE；shared 用 JBR 缓存', () => {
    // managed（缺省）
    expect(javaBinFor()).toBe('/userdata/AndroidSDK/jre/Contents/Home/bin/java')
    // custom 显式根
    expect(javaBinFor('/vol/sdk')).toBe('/vol/sdk/jre/Contents/Home/bin/java')

    // shared：检测缓存带 JBR → Studio JBR 的 java（investigate 2026-10-11 回归锚：
    // 共享根没有 <root>/jre 布局，就绪门必须走这里而不是 detectSdk 的 jre 标记）
    setSdkSourceState({
      version: 1,
      source: 'shared-studio',
      customPath: null,
      sharedPath: '/Users/t/Library/Android/sdk'
    })
    studioMocks.get.mockReturnValue({
      studioFound: true,
      studioAppPath: '/Applications/Android Studio.app',
      jbrHome: '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      sdkCandidate: '/Users/t/Library/Android/sdk',
      candidateSource: 'default-dir',
      defaultSdkPath: '/Users/t/Library/Android/sdk'
    })
    expect(javaBinFor()).toBe(
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java'
    )

    // shared 但缓存为空（检测未跑/未检得）：防御性回落传入根的内置布局
    // （共享根下不存在 → 就绪门正确报缺件）
    studioMocks.get.mockReturnValue(null)
    expect(javaBinFor()).toBe('/Users/t/Library/Android/sdk/jre/Contents/Home/bin/java')
  })

  it('boot 恢复为共享态时自动补跑一次检测；非共享态不跑', async () => {
    await loadWith(
      JSON.stringify({
        version: 1,
        source: 'shared-studio',
        customPath: null,
        sharedPath: '/Users/t/Library/Android/sdk'
      })
    )
    expect(studioMocks.run).toHaveBeenCalledTimes(1)

    resetSdkSourceStateForTest()
    studioMocks.run.mockClear()
    await loadWith(
      JSON.stringify({ version: 1, source: 'custom', customPath: '/vol/sdk', sharedPath: null })
    )
    expect(studioMocks.run).not.toHaveBeenCalled()
  })

  it('共享态 boot 检测失败不阻塞恢复（按缺件路径处理）', async () => {
    studioMocks.run.mockRejectedValueOnce(new Error('mdfind gone'))
    await loadWith(
      JSON.stringify({
        version: 1,
        source: 'shared-studio',
        customPath: null,
        sharedPath: '/Users/t/Library/Android/sdk'
      })
    )
    expect(resolveSdkRoot()).toBe('/Users/t/Library/Android/sdk')
  })
})
