import { useEffect, useRef, useState } from 'react'
import type { AboutInfo } from '@shared/types'

/**
 * 关于页数据面（镜像 useSdkSource 先例）：版本三件套与数据目录经 settings 域
 * 白名单桥拉真值——静态快照，版面打开拉一次即够，无事件跟随；打开目录按钮
 * 走同一桥的受控动作，sender 守卫在 main。桥缺席（测试环境）保留占位不伪造。
 */

export interface AboutUi {
  info: AboutInfo | null
  openDataDirectory: () => void
}

export const useAboutInfo = (): AboutUi => {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    // settings?. 双保险：真实 Api 形状恒有 settings，但测试 mock 常只挂部分域
    const about = typeof window !== 'undefined' ? window.api?.settings?.about : undefined
    if (!about) return
    void about
      .get()
      .then((value) => {
        if (mounted.current) setInfo(value)
      })
      .catch(() => undefined)
    return () => {
      mounted.current = false
    }
  }, [])

  const openDataDirectory = (): void => {
    void window.api?.settings?.about?.openDataDirectory()
  }
  return { info, openDataDirectory }
}
