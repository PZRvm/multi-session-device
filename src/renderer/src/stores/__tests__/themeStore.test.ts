import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeInitialState } from '@shared/types'

const api = vi.hoisted(() => ({
  setMode: vi.fn<(mode: string) => Promise<void>>(),
  setSystemId: vi.fn<(systemId: string) => Promise<void>>(),
  onChanged: vi.fn()
}))

/** 跨窗跟随用例里捕获 store 注册的广播监听器 */
let changeListener: ((selection: { systemId: string; mode: string }) => void) | undefined

type ThemeStoreModule = typeof import('../themeStore')

/** initial 在模块加载时捕获：每个用例重置模块树并按需注入初值 */
async function importThemeStore(initial?: ThemeInitialState): Promise<ThemeStoreModule> {
  changeListener = undefined
  api.onChanged.mockImplementation(
    (callback: (selection: { systemId: string; mode: string }) => void) => {
      changeListener = callback
      return () => {}
    }
  )
  ;(window as unknown as { api: unknown }).api =
    initial === undefined
      ? undefined
      : {
          platform: 'darwin',
          theme: {
            initial,
            setMode: api.setMode,
            setSystemId: api.setSystemId,
            onChanged: api.onChanged
          }
        }
  vi.resetModules()
  return await import('../themeStore')
}

describe('themeStore（主进程镜像）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.setMode.mockResolvedValue(undefined)
    api.setSystemId.mockResolvedValue(undefined)
    localStorage.clear()
  })

  it('无 window.api（测试环境/异常态）回落缺省：琥珀 + 跟随系统', async () => {
    const { useThemeStore } = await importThemeStore(undefined)
    expect(useThemeStore.getState().systemId).toBe('amber')
    expect(useThemeStore.getState().mode).toBe('system')
  })

  it('初值采用主进程下发的快照', async () => {
    const { useThemeStore } = await importThemeStore({
      systemId: 'moss',
      mode: 'dark',
      fresh: false
    })
    expect(useThemeStore.getState().systemId).toBe('moss')
    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('setMode / setSystemId 乐观更新并落盘主进程（不再写 localStorage）', async () => {
    const { useThemeStore } = await importThemeStore({
      systemId: 'amber',
      mode: 'system',
      fresh: false
    })
    useThemeStore.getState().setMode('dark')
    useThemeStore.getState().setSystemId('mist')
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(useThemeStore.getState().systemId).toBe('mist')
    expect(api.setMode).toHaveBeenCalledWith('dark')
    expect(api.setSystemId).toHaveBeenCalledWith('mist')
    expect(localStorage.getItem('app-theme')).toBeNull()
  })

  it('落盘失败只记录错误，状态保持乐观值（本次会话生效）', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    api.setMode.mockRejectedValueOnce(new Error('磁盘满'))
    const { useThemeStore } = await importThemeStore({
      systemId: 'amber',
      mode: 'system',
      fresh: false
    })
    useThemeStore.getState().setMode('dark')
    await vi.waitFor(() => expect(errorLog).toHaveBeenCalledWith('落盘亮暗模式失败:', '磁盘满'))
    expect(useThemeStore.getState().mode).toBe('dark')
  })

  it('跨窗跟随：收到 theme:changed 广播直写状态，不回写 IPC（不成环）', async () => {
    const { useThemeStore } = await importThemeStore({
      systemId: 'amber',
      mode: 'dark',
      fresh: false
    })
    changeListener?.({ systemId: 'mist', mode: 'light' })
    expect(useThemeStore.getState().systemId).toBe('mist')
    expect(useThemeStore.getState().mode).toBe('light')
    expect(api.setMode).not.toHaveBeenCalled()
    expect(api.setSystemId).not.toHaveBeenCalled()
  })

  describe('legacy localStorage 一次性收编', () => {
    it('fresh 首启收编旧值并清键', async () => {
      localStorage.setItem(
        'app-theme',
        JSON.stringify({ state: { systemId: 'moss', mode: 'dark' }, version: 0 })
      )
      const { useThemeStore } = await importThemeStore({
        systemId: 'amber',
        mode: 'system',
        fresh: true
      })
      expect(api.setSystemId).toHaveBeenCalledWith('moss')
      expect(api.setMode).toHaveBeenCalledWith('dark')
      expect(useThemeStore.getState().mode).toBe('dark')
      expect(localStorage.getItem('app-theme')).toBeNull()
    })

    it('非 fresh 不收编，键原样保留', async () => {
      localStorage.setItem('app-theme', JSON.stringify({ state: { mode: 'dark' }, version: 0 }))
      await importThemeStore({ systemId: 'amber', mode: 'light', fresh: false })
      expect(api.setMode).not.toHaveBeenCalled()
      expect(localStorage.getItem('app-theme')).not.toBeNull()
    })

    it('坏 legacy 清键保持缺省，不阻断启动', async () => {
      localStorage.setItem('app-theme', 'not-json')
      const { useThemeStore } = await importThemeStore({
        systemId: 'amber',
        mode: 'system',
        fresh: true
      })
      expect(api.setMode).not.toHaveBeenCalled()
      expect(useThemeStore.getState().mode).toBe('system')
      expect(localStorage.getItem('app-theme')).toBeNull()
    })

    it('旧值与缺省相同：清键但不发写', async () => {
      localStorage.setItem(
        'app-theme',
        JSON.stringify({ state: { systemId: 'amber', mode: 'system' }, version: 0 })
      )
      await importThemeStore({ systemId: 'amber', mode: 'system', fresh: true })
      expect(api.setMode).not.toHaveBeenCalled()
      expect(api.setSystemId).not.toHaveBeenCalled()
      expect(localStorage.getItem('app-theme')).toBeNull()
    })
  })
})
