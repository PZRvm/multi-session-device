import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device } from '@shared/types'
import { toApiResult } from '../api'

/** 气泡状态机：capturing 只反映在按钮 busy；copied/saved/error 挂 10s 自动消失 */
export type ScreenshotState =
  | { phase: 'idle' }
  | { phase: 'capturing' }
  | { phase: 'copied'; thumbnail: string }
  | { phase: 'saving'; thumbnail: string }
  | { phase: 'saved'; thumbnail: string; fileName: string }
  /** capture 失败无图（null）；save 失败保留原图继续展示错误 */
  | { phase: 'error'; message: string; thumbnail: string | null }

const AUTO_DISMISS_MS = 10_000

/** 截屏两段式流程的 renderer 侧状态：capture（入剪贴板）→ save（写下载目录）。
 *  暂态只存本 hook：设备离开 running 时气泡经渲染期派生收起，不落盘、不入 store */
export const useScreenshot = (
  device: Device
): {
  state: ScreenshotState
  busy: boolean
  capture: () => Promise<void>
  save: () => Promise<void>
} => {
  const [latched, setLatched] = useState<ScreenshotState>({ phase: 'idle' })
  const timerRef = useRef(0)
  const stateRef = useRef(latched)

  // ref 供 save() 同步读当前阶段：提交后同步，渲染期不写 ref
  useEffect(() => {
    stateRef.current = latched
  }, [latched])

  const clearTimer = useCallback((): void => {
    window.clearTimeout(timerRef.current)
    timerRef.current = 0
  }, [])

  /** 到达「可自动消失」的终态时布防；新截屏/新保存会重置 */
  const armAutoDismiss = useCallback((): void => {
    clearTimer()
    timerRef.current = window.setTimeout(() => setLatched({ phase: 'idle' }), AUTO_DISMISS_MS)
  }, [clearTimer])

  const capture = useCallback(async (): Promise<void> => {
    clearTimer()
    setLatched({ phase: 'capturing' })
    const result = await toApiResult(window.api.screenshot.capture(device.id))
    if (result.ok) {
      setLatched({ phase: 'copied', thumbnail: `data:image/png;base64,${result.data.pngBase64}` })
    } else {
      setLatched({ phase: 'error', message: result.error, thumbnail: null })
    }
    armAutoDismiss()
  }, [armAutoDismiss, clearTimer, device.id])

  const save = useCallback(async (): Promise<void> => {
    const current = stateRef.current
    if (current.phase !== 'copied') return
    setLatched({ phase: 'saving', thumbnail: current.thumbnail })
    const result = await toApiResult(window.api.screenshot.save(device.id))
    if (result.ok) {
      setLatched({ phase: 'saved', thumbnail: current.thumbnail, fileName: result.data.fileName })
    } else {
      setLatched({ phase: 'error', message: result.error, thumbnail: current.thumbnail })
    }
    armAutoDismiss()
  }, [armAutoDismiss, device.id])

  useEffect(() => clearTimer, [clearTimer])

  // 渲染期派生：设备离开 running（停止/切换）即收起气泡。DeviceCanvas 以
  // id:runId 为 key，重启即重挂载，底层 latched 无跨运行残留问题
  const state: ScreenshotState = device.status === 'running' ? latched : { phase: 'idle' }

  return {
    state,
    busy: state.phase === 'capturing',
    capture,
    save
  }
}
