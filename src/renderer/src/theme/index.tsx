import { useLayoutEffect, type ReactNode } from 'react'
import { ThemeProvider } from 'styled-components'
import { resolveThemeMode, THEME_SYSTEMS } from '@shared/themeSystems'
import { useThemeStore } from '../stores/themeStore'
import { applyTheme, type BoardTheme } from './apply'
import { usePrefersDark } from './usePrefersDark'

/**
 * styled-components 主题 Provider + token 注入链挂载。
 * CSS 变量承担运行时切换（零重渲染），theme 对象由同一 token 单源派生、
 * 供 TS 侧类型化取值——两机制永不分头写（DESIGN.md 双机制单源约定）。
 * 原生外观同步在主进程侧（boot 恢复 + theme:set-mode 落盘时一并设置）。
 */
export function DeviceThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const systemId = useThemeStore((s) => s.systemId)
  const mode = useThemeStore((s) => s.mode)
  const prefersDark = usePrefersDark()
  // system 模式下系统翻转 → prefersDark 变化 → resolved 变化 → 注入 effect 重刷
  // （旧实现是第二个 matchMedia effect 手动重放 applyTheme——订阅已下沉共享 hook）
  const resolved = resolveThemeMode(mode, prefersDark)

  // useLayoutEffect：绘制前注入，深色用户首帧不闪浅色
  useLayoutEffect(() => {
    applyTheme(systemId, resolved)
  }, [systemId, resolved])

  const theme: BoardTheme = {
    ...THEME_SYSTEMS[systemId][resolved],
    colorScheme: resolved,
    systemId
  }
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}
