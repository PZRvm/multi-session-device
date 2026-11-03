import { useEffect, useState } from 'react'

/** 系统暗色判定的共享订阅（review P3-1 收口）：provider 的 CSS 变量刷新与
 *  消费组件（如板头亮暗切换钮）共用这一份 matchMedia 监听。
 *  既有约定在此显式化：store 的 mode 在 system 下不随系统翻转更新——provider
 *  只刷 CSS 变量不动 store；需要「当前解析态」的消费方一律走本 hook。 */
export function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState<boolean>(() =>
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setPrefersDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return prefersDark
}
