import { useLayoutEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'styled-components'
import { THEME_SYSTEMS } from '@shared/themeSystems'
import { useThemeStore } from '../stores/themeStore'
import { applyTheme, resolveMode, type BoardTheme } from './apply'

/**
 * styled-components 主题 Provider + token 注入链挂载。
 * CSS 变量承担运行时切换（零重渲染），theme 对象由同一 token 单源派生、
 * 供 TS 侧类型化取值——两机制永不分头写（DESIGN.md 双机制单源约定）。
 */
export function DeviceThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const systemId = useThemeStore((s) => s.systemId)
  const mode = useThemeStore((s) => s.mode)
  const resolved = resolveMode(mode)

  // useLayoutEffect：绘制前注入，深色用户首帧不闪浅色
  useLayoutEffect(() => {
    applyTheme(systemId, resolved)
  }, [systemId, resolved])

  useLayoutEffect(() => {
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyTheme(systemId, resolveMode('system'))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode, systemId])

  const theme: BoardTheme = {
    ...THEME_SYSTEMS[systemId][resolved],
    colorScheme: resolved,
    systemId
  }
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
