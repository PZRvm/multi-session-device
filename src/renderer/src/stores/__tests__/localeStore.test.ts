import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocaleInitialState } from '@shared/types'

const api = vi.hoisted(() => ({
  set: vi.fn<(locale: string) => Promise<void>>(),
  onChanged: vi.fn()
}))

/** 跨窗跟随用例里捕获 store 注册的广播监听器 */
let changeListener: ((selection: { locale: string }) => void) | undefined

type LocaleStoreModule = typeof import('../localeStore')

/** initial 在模块加载时捕获：每个用例重置模块树并按需注入初值 */
async function importLocaleStore(initial?: LocaleInitialState): Promise<LocaleStoreModule> {
  changeListener = undefined
  api.onChanged.mockImplementation((callback: (selection: { locale: string }) => void) => {
    changeListener = callback
    return () => {}
  })
  ;(window as unknown as { api: unknown }).api =
    initial === undefined
      ? undefined
      : { platform: 'darwin', locale: { initial, set: api.set, onChanged: api.onChanged } }
  vi.resetModules()
  return await import('../localeStore')
}

describe('localeStore（主进程镜像）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.set.mockResolvedValue(undefined)
  })

  it('无 window.api（测试环境/异常态）回落缺省 zh-CN', async () => {
    const { useLocaleStore } = await importLocaleStore(undefined)
    expect(useLocaleStore.getState().locale).toBe('zh-CN')
  })

  it('初值采用主进程下发的快照', async () => {
    const { useLocaleStore } = await importLocaleStore({ locale: 'en-US' })
    expect(useLocaleStore.getState().locale).toBe('en-US')
  })

  it('setLocale 乐观更新并落盘主进程', async () => {
    const { useLocaleStore } = await importLocaleStore({ locale: 'zh-CN' })
    useLocaleStore.getState().setLocale('zh-TW')
    expect(useLocaleStore.getState().locale).toBe('zh-TW')
    expect(api.set).toHaveBeenCalledWith('zh-TW')
  })

  it('落盘失败只记录错误，状态保持乐观值（本次会话生效）', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.set.mockRejectedValueOnce(new Error('磁盘满'))
    const { useLocaleStore } = await importLocaleStore({ locale: 'zh-CN' })
    useLocaleStore.getState().setLocale('en-US')
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledWith('落盘界面语言失败:', '磁盘满'))
    expect(useLocaleStore.getState().locale).toBe('en-US')
  })

  it('跨窗跟随：收到 locale:changed 广播直写状态，不回写 IPC（不成环）', async () => {
    const { useLocaleStore } = await importLocaleStore({ locale: 'zh-CN' })
    changeListener?.({ locale: 'zh-TW' })
    expect(useLocaleStore.getState().locale).toBe('zh-TW')
    expect(api.set).not.toHaveBeenCalled()
  })
})
