// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_COPY } from '@shared/i18n'
import type { SdkSourceSnapshot, SdkSourceSwitchEvaluation } from '@shared/types'
import PaneEmulator from '../settings/PaneEmulator'
import { SETTINGS_PREVIEW, type SettingsViewModel } from '../settings/model'

afterEach(cleanup)

const previewModel = (): SettingsViewModel => ({
  ...SETTINGS_PREVIEW,
  appearance: {
    mode: 'system',
    systemId: 'amber',
    onModeChange: vi.fn(),
    onSystemIdChange: vi.fn()
  },
  locale: 'zh-CN',
  onLocaleChange: vi.fn()
})

const detectionOf = (
  over: Partial<SdkSourceSnapshot['detection']> = {}
): NonNullable<SdkSourceSnapshot['detection']> => ({
  studioFound: true,
  studioAppPath: '/Applications/Android Studio.app',
  jbrHome: null,
  sdkCandidate: '/Users/t/Library/Android/sdk',
  candidateSource: 'default-dir',
  defaultSdkPath: '/Users/t/Library/Android/sdk',
  ...over
})

const snapshotOf = (over: Partial<SdkSourceSnapshot> = {}): SdkSourceSnapshot => ({
  source: 'managed',
  managedRoot: '/data/AndroidSDK',
  customPath: null,
  sharedPath: null,
  detection: detectionOf(),
  migration: null,
  journalCorrupt: false,
  retainedRoots: [],
  ...over
})

interface SdkApiMock {
  detectStudio: ReturnType<typeof vi.fn>
  sourceGet: ReturnType<typeof vi.fn>
  sourceSet: ReturnType<typeof vi.fn>
  sourceMigrate: ReturnType<typeof vi.fn>
  sourceAdopt: ReturnType<typeof vi.fn>
  sourceMigrateCancel: ReturnType<typeof vi.fn>
  sourceClearRetained: ReturnType<typeof vi.fn>
  chooseCustomRoot: ReturnType<typeof vi.fn>
  onSourceChanged: ReturnType<typeof vi.fn>
  onMigrateProgress: ReturnType<typeof vi.fn>
  dialogShow: ReturnType<typeof vi.fn>
  listeners: { changed: (() => void)[]; progress: ((p: unknown) => void)[] }
}

const installApi = (snapshot: SdkSourceSnapshot): SdkApiMock => {
  const live = snapshot
  const listeners: SdkApiMock['listeners'] = { changed: [], progress: [] }
  const off = (): (() => void) => vi.fn()
  const mock: SdkApiMock = {
    detectStudio: vi.fn(async () => live.detection),
    sourceGet: vi.fn(async () => live),
    sourceSet: vi.fn(async (): Promise<SdkSourceSwitchEvaluation> => ({
      action: 'direct',
      snapshot: live
    })),
    sourceMigrate: vi.fn(async () => 'started' as const),
    sourceAdopt: vi.fn(async () => live),
    sourceMigrateCancel: vi.fn(async () => 'done' as const),
    sourceClearRetained: vi.fn(async () => live),
    chooseCustomRoot: vi.fn(async () => null),
    onSourceChanged: vi.fn((cb: () => void) => {
      listeners.changed.push(cb)
      return off()
    }),
    onMigrateProgress: vi.fn((cb: (p: unknown) => void) => {
      listeners.progress.push(cb)
      return off()
    }),
    dialogShow: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
    listeners
  }
  ;(window as unknown as { api: unknown }).api = {
    dialog: { show: mock.dialogShow },
    sdk: mock
  }
  return mock
}

const openPane = async (api: SdkApiMock): Promise<void> => {
  render(<PaneEmulator model={previewModel()} copy={SETTINGS_COPY['zh-CN']} />)
  // 等挂载 effect 落地（检测 + 快照拉取），避免与初始渲染竞态
  await waitFor(() => {
    expect(api.sourceGet).toHaveBeenCalled()
  })
}

describe('PaneEmulator（SDK 来源交互化）', () => {
  let api: SdkApiMock
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Studio 未装：共享单选禁用并显示原因；重检测按钮在共享行可用', async () => {
    api = installApi(
      snapshotOf({ detection: detectionOf({ studioFound: false, sdkCandidate: null }) })
    )
    await openPane(api)
    const shared = screen.getByRole('radio', { name: '共享 Android Studio SDK' })
    expect(shared.matches(':disabled')).toBe(true)
    expect(screen.getByText('未检测到 Android Studio——安装后可用共享 SDK')).toBeTruthy()
    fireEvent.click(shared)
    expect(api.sourceSet).not.toHaveBeenCalled()
  })

  it('点共享（Studio 在场）：sourceSet 走矩阵判定；direct 即完成不弹窗', async () => {
    api = installApi(snapshotOf())
    await openPane(api)
    fireEvent.click(screen.getByRole('radio', { name: '共享 Android Studio SDK' }))
    await waitFor(() => {
      expect(api.sourceSet).toHaveBeenCalledWith('shared-studio', undefined)
    })
    expect(api.dialogShow).not.toHaveBeenCalled()
  })

  it('needs-migration：评估并入单个原生确认弹窗 → 确认后 sourceMigrate', async () => {
    api = installApi(snapshotOf())
    api.sourceSet.mockResolvedValueOnce({
      action: 'needs-migration',
      fromRoot: '/data/AndroidSDK',
      toRoot: '/vol/sdk',
      bytes: 6_600_000_000,
      boundDevices: 3
    } as SdkSourceSwitchEvaluation)
    await openPane(api)
    api.chooseCustomRoot.mockResolvedValueOnce('/vol/sdk')
    fireEvent.click(screen.getByRole('radio', { name: '自选 SDK 路径' }))
    await waitFor(() => {
      expect(api.dialogShow).toHaveBeenCalledTimes(1)
    })
    const options = api.dialogShow.mock.calls[0]![0] as Record<string, unknown>
    expect(options['title']).toBe('确认迁移 SDK')
    expect(options['message']).toContain('/data/AndroidSDK → /vol/sdk')
    expect(options['message']).toContain('6.1 GB')
    expect(options['detail'] as string).toContain('3 台设备')
    expect(options['buttons']).toEqual(['开始迁移…', '取消'])
    expect(options['cancelId']).toBe(1)
    await waitFor(() => {
      expect(api.sourceMigrate).toHaveBeenCalledWith('custom', '/vol/sdk', false)
    })
  })

  it('needs-choice：三按钮弹窗，替换迁移与直接使用各走各的提交', async () => {
    api = installApi(snapshotOf())
    api.sourceSet.mockResolvedValueOnce({
      action: 'needs-choice',
      targetRoot: '/vol/sdk',
      targetBytes: 6_800_000_000,
      loserRoot: '/data/AndroidSDK',
      loserBytes: 6_200_000_000,
      loserBoundDevices: 2
    } as SdkSourceSwitchEvaluation)
    await openPane(api)
    api.chooseCustomRoot.mockResolvedValueOnce('/vol/sdk')
    fireEvent.click(screen.getByRole('radio', { name: '自选 SDK 路径' }))
    await waitFor(() => {
      expect(api.dialogShow).toHaveBeenCalledTimes(1)
    })
    const options = api.dialogShow.mock.calls[0]![0] as Record<string, unknown>
    expect(options['title']).toBe('目标路径已有 SDK')
    expect(options['message']).toContain('/vol/sdk')
    expect(options['detail'] as string).toContain('① ')
    expect(options['detail'] as string).toContain('② ')
    expect(options['detail'] as string).toContain('/data/AndroidSDK')
    expect(options['detail'] as string).toContain('2 台设备')
    expect(options['buttons']).toEqual(['迁移替换…', '直接使用…', '取消'])
    expect(options['cancelId']).toBe(2)
    // 默认 mock response 0 = 迁移替换
    await waitFor(() => {
      expect(api.sourceMigrate).toHaveBeenCalledWith('custom', '/vol/sdk', true)
    })

    // 直接使用分支：response 1
    api.sourceSet.mockResolvedValueOnce({
      action: 'needs-choice',
      targetRoot: '/vol/sdk',
      targetBytes: 6_800_000_000,
      loserRoot: '/data/AndroidSDK',
      loserBytes: 6_200_000_000,
      loserBoundDevices: 0
    } as SdkSourceSwitchEvaluation)
    api.dialogShow.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    api.chooseCustomRoot.mockResolvedValueOnce('/vol/sdk')
    fireEvent.click(screen.getByRole('radio', { name: '自选 SDK 路径' }))
    await waitFor(() => {
      expect(api.sourceAdopt).toHaveBeenCalledWith('custom', '/vol/sdk')
    })
  })

  it('弹窗取消：不提交动作，窗口无残留', async () => {
    api = installApi(snapshotOf())
    api.sourceSet.mockResolvedValueOnce({
      action: 'needs-migration',
      fromRoot: '/data/AndroidSDK',
      toRoot: '/vol/sdk',
      bytes: 1000,
      boundDevices: 0
    } as SdkSourceSwitchEvaluation)
    api.dialogShow.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await openPane(api)
    api.chooseCustomRoot.mockResolvedValueOnce('/vol/sdk')
    fireEvent.click(screen.getByRole('radio', { name: '自选 SDK 路径' }))
    await waitFor(() => {
      expect(api.dialogShow).toHaveBeenCalledTimes(1)
    })
    expect(api.sourceMigrate).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: '迁移 SDK' })).toBeNull()
  })

  it('rejected：词条映射到错误行（运行会话示例）', async () => {
    api = installApi(snapshotOf())
    api.sourceSet.mockResolvedValueOnce({
      action: 'rejected',
      code: 'running-sessions'
    } as SdkSourceSwitchEvaluation)
    await openPane(api)
    fireEvent.click(screen.getByRole('radio', { name: '共享 Android Studio SDK' }))
    await waitFor(() => {
      expect(screen.getByText('请先停止运行中的设备再切换')).toBeTruthy()
    })
  })

  it('迁移进度：进行中可取消（回滚）；journal 未收尾出崩溃恢复横幅', async () => {
    api = installApi(snapshotOf({ migration: null }))
    await openPane(api)
    // 进行中进度：经订阅注入
    api.listeners.progress[0]?.({
      phase: 'moving',
      percent: 42,
      movedBytes: 2_600_000_000,
      totalBytes: 6_200_000_000,
      currentEntry: 'system-images/android-34'
    })
    expect(await screen.findByText(/42%/)).toBeTruthy()
    expect(screen.getByText(/system-images\/android-34/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消（回滚）' }))
    await waitFor(() => {
      expect(api.sourceMigrateCancel).toHaveBeenCalledTimes(1)
    })

    // journal 未收尾（无活动进度）：崩溃恢复横幅 + 继续迁移
    const withJournal = snapshotOf({
      migration: {
        fromRoot: '/data/AndroidSDK',
        toRoot: '/vol/sdk',
        targetSource: 'custom',
        phase: 'moving',
        doneEntries: 2,
        totalEntries: 8,
        movedBytes: 1_000_000_000,
        totalBytes: 6_200_000_000
      }
    })
    // 终态进度（cancelled）先行，横幅的 !progressActive 条件才成立
    api.listeners.progress[0]?.({
      phase: 'cancelled',
      percent: 0,
      movedBytes: 0,
      totalBytes: 0,
      currentEntry: null
    })
    api.sourceGet.mockResolvedValueOnce(withJournal)
    api.listeners.changed[0]?.()
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('上次迁移未完成')
    fireEvent.click(screen.getByRole('button', { name: '继续迁移…' }))
    await waitFor(() => {
      expect(api.sourceMigrate).toHaveBeenCalledWith('managed', undefined, false)
    })
  })

  it('保留根区（仅共享模式）：清除经原生确认 → sourceClearRetained', async () => {
    api = installApi(
      snapshotOf({
        source: 'shared-studio',
        sharedPath: '/Users/t/Library/Android/sdk',
        customPath: '/vol/sdk',
        retainedRoots: [{ root: '/data/AndroidSDK', bytes: 6_200_000_000, boundDevices: 3 }]
      })
    )
    await openPane(api)
    expect(screen.getByText('保留的 SDK（仅共享模式）')).toBeTruthy()
    expect(screen.getByText(/\/data\/AndroidSDK/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除…' }))
    await waitFor(() => {
      expect(api.dialogShow).toHaveBeenCalledTimes(1)
      expect(api.sourceClearRetained).toHaveBeenCalledWith('/data/AndroidSDK')
    })
  })

  it('选中来源行内展示路径与入口：托管显路径、自选带「更换路径…」、共享带「重新检测」', async () => {
    api = installApi(
      snapshotOf({
        source: 'custom',
        customPath: '/vol/sdk',
        sharedPath: '/Users/t/Library/Android/sdk'
      })
    )
    await openPane(api)
    // 自选选中：行内路径 + 更换路径入口（原 SDK 目录板块并入）
    expect(screen.getByText('/vol/sdk')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更换路径…' }))
    await waitFor(() => {
      expect(api.chooseCustomRoot).toHaveBeenCalledTimes(1)
    })

    // 共享选中：行内显示共享路径 + 重新检测
    const shared = snapshotOf({
      source: 'shared-studio',
      customPath: null,
      sharedPath: '/Users/t/Library/Android/sdk'
    })
    api.sourceGet.mockResolvedValue(shared)
    api.listeners.changed[0]?.()
    await waitFor(() => {
      expect(screen.getByText('/Users/t/Library/Android/sdk')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: '重新检测' })).toBeTruthy()
    // 板块已删：不再出现「SDK 目录」标题
    expect(screen.queryByText('SDK 目录')).toBeNull()
  })

  it('迁移完成：终态卡片短暂显示「迁移完成」后自动收起', async () => {
    api = installApi(snapshotOf())
    await openPane(api)
    vi.useFakeTimers()
    try {
      act(() => {
        api.listeners.progress[0]?.({
          phase: 'done',
          percent: 100,
          movedBytes: 6_200_000_000,
          totalBytes: 6_200_000_000,
          currentEntry: null
        })
      })
      expect(screen.getByText('迁移完成')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '取消（回滚）' })).toBeNull()
      act(() => {
        vi.advanceTimersByTime(2_500)
      })
      expect(screen.queryByText('迁移完成')).toBeNull()
      expect(screen.queryByText('正在迁移 SDK')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('防御性收口：终态事件丢失时，source-changed 刷新把滞留活动进度强制置 done 并收起', async () => {
    api = installApi(snapshotOf())
    await openPane(api)
    vi.useFakeTimers()
    try {
      act(() => {
        api.listeners.progress[0]?.({
          phase: 'moving',
          percent: 100,
          movedBytes: 6_200_000_000,
          totalBytes: 6_200_000_000,
          currentEntry: 'system-images/android-34'
        })
      })
      expect(screen.getByText('正在迁移 SDK')).toBeTruthy()
      // 终态进度事件丢失：只有 source-changed 到达，快照里 migration 已为 null
      api.sourceGet.mockResolvedValueOnce(snapshotOf())
      // async act 在假时钟下冲刷 sourceGet promise：胁迫出的终态与停留计时都进 fake 队列
      await act(async () => {
        api.listeners.changed[0]?.()
      })
      expect(screen.getByText('迁移完成')).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(2_500)
      })
      expect(screen.queryByText('迁移完成')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('journal 损坏横幅：只提供回滚入口，点击调 sourceMigrateCancel', async () => {
    api = installApi(snapshotOf({ journalCorrupt: true }))
    await openPane(api)
    const banner = await screen.findByRole('alert')
    expect(banner.textContent).toContain('迁移记录损坏')
    expect(screen.queryByRole('button', { name: '继续迁移…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '回滚…' }))
    await waitFor(() => {
      expect(api.sourceMigrateCancel).toHaveBeenCalledTimes(1)
    })
  })

  it('非共享模式：不渲染保留根区', async () => {
    api = installApi(snapshotOf())
    await openPane(api)
    expect(screen.queryByText('保留的 SDK（仅共享模式）')).toBeNull()
  })
})
