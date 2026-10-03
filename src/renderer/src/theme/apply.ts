import { themeCssVariables, type ThemeModeTokens, type ThemeSystemId } from '@shared/themeSystems'
import type { ThemeMode } from '../stores/themeStore'

export type ResolvedMode = 'light' | 'dark'

/** 亮暗解析：跟随系统走 matchMedia，显式亮/暗直读 */
export function resolveMode(mode: ThemeMode): ResolvedMode {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

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
