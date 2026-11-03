import type { SettingsLocale } from '@shared/i18n'
import { useLocaleStore } from '../stores/localeStore'

/** 按域取词：传入任一域的三语记录（如 SETTINGS_COPY / MAIN_COPY），返回当前语言那份。
 *  语言变化（本窗切换或他窗广播）经 localeStore 触发重渲染，组件消费方式
 *  与旧局部字典一致——迁移只换 import 来源与取词入口 */
export const useCopy = <T>(domain: Record<SettingsLocale, T>): T =>
  domain[useLocaleStore((state) => state.locale)]
