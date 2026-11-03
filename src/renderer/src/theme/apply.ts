import {
  themeCssVariables,
  type ResolvedMode,
  type ThemeModeTokens,
  type ThemeSystemId
} from '@shared/themeSystems'

export type { ResolvedMode } from '@shared/themeSystems'

/** token 注入链：CSS 变量与 color-scheme 同链路切换（learn 2026-10-01 深字深底静默事故的根治路径） */
export function applyTheme(systemId: ThemeSystemId, resolved: ResolvedMode): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeCssVariables(systemId, resolved))) {
    root.style.setProperty(name, value)
  }
  root.style.colorScheme = resolved
}

export interface BoardTheme extends ThemeModeTokens {
  colorScheme: ResolvedMode
  systemId: ThemeSystemId
}
