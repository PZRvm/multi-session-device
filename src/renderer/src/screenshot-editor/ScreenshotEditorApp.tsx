import { useEffect, useState } from 'react'
import { SCREENSHOT_EDITOR_COPY } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import { toApiResult } from '../api'

/** 编辑窗取图状态：loading → loaded（缓存现图）或 error（主进程已本地化的
 *  具体错误，如空缓存 stale 如实呈现——不伪造内容） */
type EditImageState =
  | { phase: 'loading' }
  | { phase: 'loaded'; captureId: string; dataUrl: string }
  | { phase: 'error'; message: string }

/**
 * T3 接线版编辑窗根（plan 2026-11-02-screenshot-editor）：先打通「独立窗口 →
 * preload → main 编辑通道 → 缓存现图」的真实取图链路，T4 迁入的 EditorWindow
 * （工具条 + Konva 双画布）替换本展示层——取图契约（getEditImage 一次拉取）与
 * 建窗 query 不变。设备归属不经 renderer 自报：main 按 sender 登记表解析
 */
const ScreenshotEditorApp = (): React.JSX.Element => {
  const copy = useCopy(SCREENSHOT_EDITOR_COPY)
  const [image, setImage] = useState<EditImageState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    void toApiResult(window.api.screenshot.getEditImage()).then((result) => {
      if (cancelled) return
      setImage(
        result.ok
          ? { phase: 'loaded', captureId: result.data.captureId, dataUrl: result.data.dataUrl }
          : { phase: 'error', message: result.error }
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (image.phase === 'loading') return <div>{copy.loading}</div>
  if (image.phase === 'error') {
    return (
      <div role="alert">
        {copy.failed}：{image.message}
      </div>
    )
  }
  return <img src={image.dataUrl} alt={copy.toolbarAria} />
}

export default ScreenshotEditorApp
