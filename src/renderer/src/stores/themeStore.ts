import { create } from 'zustand'
import { isThemeMode, isThemeSystemId, type ThemeSystemId } from '@shared/themeSystems'
import type { ThemeInitialState, ThemeMode } from '@shared/types'
import { toApiResult } from '../api'

/** 亮暗模式三态：跟随系统 / 亮 / 暗 */
export type { ThemeMode } from '@shared/types'

interface ThemeState {
  systemId: ThemeSystemId
  mode: ThemeMode
  setSystemId: (systemId: ThemeSystemId) => void
  setMode: (mode: ThemeMode) => void
}

/** 单一事实源在主进程 theme.json（跨源/跨端口一致，重启保留）；本 store 是渲染侧镜像：
 *  初值同步取自 preload（首帧零闪），写动作乐观更新 + 落盘——失败只记录，本次会话
 *  生效、下次启动回退（与主进程「内存先行」语义对齐） */
const initial: ThemeInitialState = window.api?.theme?.initial ?? {
  systemId: 'amber',
  mode: 'system',
  fresh: false
}

export const useThemeStore = create<ThemeState>()((set) => ({
  systemId: initial.systemId,
  mode: initial.mode,
  setSystemId: (systemId) => {
    set({ systemId })
    void toApiResult(window.api.theme.setSystemId(systemId)).then((result) => {
      if (!result.ok) console.error('落盘主题色失败:', result.error)
    })
  },
  setMode: (mode) => {
    set({ mode })
    void toApiResult(window.api.theme.setMode(mode)).then((result) => {
      if (!result.ok) console.error('落盘亮暗模式失败:', result.error)
    })
  }
}))

/** legacy localStorage（zustand persist 键 app-theme）一次性收编：仅 theme.json 缺失的
 *  首启执行，收编后清键；坏值直接清键、保持主进程缺省。多 dev 端口各有存量时，
 *  以最先启动的源为准（theme.json 一旦存在 fresh 即 false） */
export function adoptLegacyTheme(): void {
  if (!initial.fresh) return
  const raw = localStorage.getItem('app-theme')
  if (raw === null) return
  localStorage.removeItem('app-theme')
  try {
    const legacy = (JSON.parse(raw) as { state?: { systemId?: unknown; mode?: unknown } }).state
    if (legacy === undefined) return
    const store = useThemeStore.getState()
    if (isThemeSystemId(legacy.systemId) && legacy.systemId !== store.systemId) {
      store.setSystemId(legacy.systemId)
    }
    if (isThemeMode(legacy.mode) && legacy.mode !== store.mode) {
      store.setMode(legacy.mode)
    }
  } catch {
    // 坏 legacy 不阻断启动；键已清，保持缺省
  }
}

adoptLegacyTheme()

// 跨窗跟随（issue 2026-10-06-theme-no-cross-window-sync）：任一窗切换 → main 广播 →
// 各窗 store 直写。不经 setMode/setSystemId——那会回写 IPC 成环；发起窗收到同值直写幂等
window.api?.theme?.onChanged?.((selection) => {
  useThemeStore.setState({ systemId: selection.systemId, mode: selection.mode })
})
