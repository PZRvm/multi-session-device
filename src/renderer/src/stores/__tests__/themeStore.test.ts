import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '../themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ systemId: 'amber', mode: 'system' })
  })

  it('冒烟：缺省 = 琥珀 + 跟随系统', () => {
    const state = useThemeStore.getState()
    expect(state.systemId).toBe('amber')
    expect(state.mode).toBe('system')
  })

  it('setMode / setSystemId 更新状态并经 persist 落 localStorage', () => {
    useThemeStore.getState().setMode('dark')
    useThemeStore.getState().setSystemId('moss')
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(useThemeStore.getState().systemId).toBe('moss')

    const raw = JSON.parse(localStorage.getItem('app-theme') ?? '{}')
    expect(raw.state.mode).toBe('dark')
    expect(raw.state.systemId).toBe('moss')
  })
})
