import { create } from 'zustand'
import { DEFAULT_LOCALE, type SettingsLocale } from '@shared/i18n'
import type { LocaleInitialState } from '@shared/types'
import { toApiResult } from '../api'

interface LocaleState {
  locale: SettingsLocale
  setLocale: (locale: SettingsLocale) => void
}

/** 单一事实源在主进程 locale.json（重启保留）；本 store 是渲染侧镜像：
 *  初值同步取自 preload，写动作乐观更新 + 落盘——失败只记录，本次会话生效、
 *  下次启动回退（与主进程「内存先行」语义对齐）。语言无 legacy 存量，无收编段 */
const initial: LocaleInitialState = window.api?.locale?.initial ?? { locale: DEFAULT_LOCALE }

export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: initial.locale,
  setLocale: (locale) => {
    set({ locale })
    void toApiResult(window.api.locale.set(locale)).then((result) => {
      if (!result.ok) console.error('落盘界面语言失败:', result.error)
    })
  }
}))

// 跨窗跟随：任一窗切换 → main 广播 → 各窗 store 直写。不经 setLocale——那会回写
// IPC 成环；发起窗收到同值直写幂等
window.api?.locale?.onChanged?.((selection) => {
  useLocaleStore.setState({ locale: selection.locale })
})
