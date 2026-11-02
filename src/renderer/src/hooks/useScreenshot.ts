import { useCallback, useEffect, useRef, useState } from 'react'
import type { Device } from '@shared/types'
import { toApiResult } from '../api'

/** 气泡状态机：capturing 只反映在按钮 busy；copied/saved 挂 10s 自动消失；error 不自动消失
 *  （由关闭钮、下一次截屏或设备切换收起） */
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
  device: Pick<Device, 'id' | 'status'>
): {
  state: ScreenshotState
  busy: boolean
  capture: () => Promise<void>
  save: () => Promise<void>
  /** 打开截图编辑子窗（plan 2026-11-02-screenshot-editor T5）：走缓存现图，
   *  不发起 adb 截屏；成功不改变气泡态（编辑窗独立呈现），失败落入 error */
  edit: () => Promise<void>
  /** 开窗进行中（独立 busy，不与截屏 capturing 互斥） */
  editing: boolean
  dismiss: () => void
} => {
  const [latched, setLatched] = useState<ScreenshotState>({ phase: 'idle' })
  const [editing, setEditing] = useState(false)
  const timerRef = useRef(0)
  const stateRef = useRef(latched)
  /** 开窗在途标志的同步镜像：点击即读（提交前 state 有延迟），防重复开窗 */
  const editingRef = useRef(false)
  /** 单调操作序号：异步完成时 seq 不匹配即过期丢弃（读提交后 state 有提交延迟，不可靠） */
  const opSeqRef = useRef(0)

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
    const seq = ++opSeqRef.current
    clearTimer()
    setLatched({ phase: 'capturing' })
    const result = await toApiResult(window.api.screenshot.capture(device.id))
    if (seq !== opSeqRef.current) return
    if (result.ok) {
      setLatched({ phase: 'copied', thumbnail: `data:image/png;base64,${result.data.pngBase64}` })
      armAutoDismiss()
    } else {
      setLatched({ phase: 'error', message: result.error, thumbnail: null })
    }
  }, [armAutoDismiss, clearTimer, device.id])

  const save = useCallback(async (): Promise<void> => {
    const current = stateRef.current
    if (current.phase !== 'copied') return
    const seq = ++opSeqRef.current
    clearTimer()
    setLatched({ phase: 'saving', thumbnail: current.thumbnail })
    const result = await toApiResult(window.api.screenshot.save(device.id))
    // 过期丢弃：save 期间用户可能已重新截屏（P3-9）或点了关闭——旧结果不覆盖新态
    if (seq !== opSeqRef.current) return
    if (result.ok) {
      setLatched({ phase: 'saved', thumbnail: current.thumbnail, fileName: result.data.fileName })
      armAutoDismiss()
    } else {
      setLatched({ phase: 'error', message: result.error, thumbnail: current.thumbnail })
    }
  }, [armAutoDismiss, clearTimer, device.id])

  const edit = useCallback(async (): Promise<void> => {
    if (editingRef.current) return
    editingRef.current = true
    setEditing(true)
    const seq = ++opSeqRef.current
    const result = await toApiResult(window.api.screenshot.openEditor(device.id))
    // busy 无条件复员（钮可用性），错误回填才看过期
    editingRef.current = false
    setEditing(false)
    if (seq !== opSeqRef.current) return
    if (result.ok) return
    // 开窗失败有错误归宿：error 态保留现有缩略图（save 失败同款），不自动消失
    const current = stateRef.current
    const thumbnail =
      current.phase === 'copied' || current.phase === 'saving' || current.phase === 'saved'
        ? current.thumbnail
        : null
    clearTimer()
    setLatched({ phase: 'error', message: result.error, thumbnail })
  }, [clearTimer, device.id])

  useEffect(() => clearTimer, [clearTimer])

  const dismiss = useCallback((): void => {
    opSeqRef.current += 1
    clearTimer()
    setLatched({ phase: 'idle' })
  }, [clearTimer])

  // 渲染期派生：设备离开 running（停止/切换）即收起气泡。DeviceCanvas 以
  // id:runId 为 key，重启即重挂载，底层 latched 无跨运行残留问题
  const state: ScreenshotState = device.status === 'running' ? latched : { phase: 'idle' }

  return {
    state,
    busy: state.phase === 'capturing',
    capture,
    save,
    edit,
    editing,
    dismiss
  }
}
