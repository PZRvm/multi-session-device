import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeSystemId } from '@shared/themeSystems'

/** 亮暗模式三态：跟随系统 / 亮 / 暗 */
export type ThemeMode = 'system' | 'light' | 'dark'

interface ThemeState {
  systemId: ThemeSystemId
  mode: ThemeMode
  setSystemId: (systemId: ThemeSystemId) => void
  setMode: (mode: ThemeMode) => void
}

/** 主题选择（localStorage 持久化；stage 05 设置窗落地时迁 IPC 后端，接口不变） */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      systemId: 'amber',
      mode: 'system',
      setSystemId: (systemId) => set({ systemId }),
      setMode: (mode) => set({ mode })
    }),
    { name: 'app-theme' }
  )
)
