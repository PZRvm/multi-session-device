// 截图编辑子窗渲染根（plan 2026-11-02-screenshot-editor T4，迁自 multi-session-browser
// captureEditor/EditorWindow.tsx）：窗根 = 纵向 flex——顶部工具条（EditorToolbar，
// chrome 系自绘）+ 右上产出钮（复制到剪贴板/下载）+ 中部画布区（AnnotationStage
// 居中，checker 底）+ 窗内错误条。
//
// 取图链：挂载即 window.api.screenshot.getEditImage() → Image 解码入 Stage；期间
// 显示 loading 文案，失败（空槽/坏数据/解码失败）经 toApiResult 取主进程本地化
// 错误文案（解码失败等内部异常用域字典兜底文案）显示在窗内如实报错。持有
// captureId 供产出对账。
//
// 撤销/重做：标注数组 + 视口的快照栈（裁剪确认也入栈），HISTORY_LIMIT 截长。
//
// 产出链：stage.toDataURL({ 当前视口×scale, pixelRatio: 1/scale }) 还原原图像像素
// （马赛克滤镜在节点缓存画布中随导出合成；导出前隐藏裁剪浮层）→ editCopy /
// editDownload（captureId 对账）。成功后窗内 inline 结果反馈（头部位短文案 2.1s
// 起淡出、2.6s 移除，不弹浮层**不自动关窗**——用户裁决）；失败显示在窗内错误条、
// 留在编辑态（会话已失效 → 主进程报「截图已过期」如实呈现，不伪造成功）。
//
// 产出后续编（实现细节，计划未明示的必要补全）：edit-copy/edit-download 成功后
// 主进程回写本窗会话并**换新 captureId**——旧引用随即
// 过期，若不刷新则用户复制后再点下载必报「截图已过期」（假错误）。故每次产出
// 成功后重取 getEditImage 把编辑基准续到本窗新版本：成品已含全部标注（标注数组清零、
// 撤销栈重置、AnnotationStage 按 captureId 重挂清内部草稿态），画布视觉不变、可
// 继续叠加标注。续编取图失败如实上错误条、已示成功 flash 不撤——输出成功与续编
// 失败分别呈现，不把已落盘误报为未保存。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download } from 'lucide-react'
import type { CaptureEditImagePayload } from '@shared/screenshot-editor'
import { SCREENSHOT_EDITOR_COPY, format, type ScreenshotEditorCopy } from '@shared/i18n'
import { toApiResult } from '../../api'
import { useCopy } from '../../hooks/useCopy'
import { useLocaleStore } from '../../stores/localeStore'
import { AnnotationStage, type AnnotationStageHandle } from './AnnotationStage'
import { EditorShell } from './editorWrapper'
import { EditorToolbar } from './EditorToolbar'
import {
  COLOR_PALETTE,
  HISTORY_LIMIT,
  applyCropFrame,
  type Annotation,
  type AnnotationColor,
  type EditorSnapshot,
  type EditorToolId
} from './editorConstants'

/** 事件外取词（挂载取图链 async 内用，源 EditorWindow storeT 同模式）：经
 *  localeStore 现值取当前语言那份域字典——错误文案随当前语言，不闭包首帧语言 */
function storeCopy(): ScreenshotEditorCopy {
  return SCREENSHOT_EDITOR_COPY[useLocaleStore.getState().locale]
}

/** darwin 无标题条形态门控（源经建窗 chrome query 判定；本项目 T3 建窗统一
 *  hiddenInset——窗口形态单源 = 主进程建窗配置，renderer 不经 navigator 推断
 *  平台，改读 preload 注入的 process.platform）：为真时顶部工具条承担窗口拖动
 *  （CSS app-region drag，控件 no-drag）且左让原生红绿灯位。模块加载时读一次
 *  ——平台在一次窗生命周期内不变 */
const HIDDEN_TITLEBAR_CHROME = window.api?.platform === 'darwin'

/** inline 成功反馈的显隐节律（ms）：2.1s 起淡出、2.6s 移除 */
const FLASH_FADE_AT = 2100
const FLASH_CLEAR_AT = 2600

interface EditorHistory {
  past: EditorSnapshot[]
  present: EditorSnapshot
  future: EditorSnapshot[]
}

/** 底图解码（dataUrl → HTMLImageElement）；解码失败以空 message Error 上抛
 *  （消费侧 editErrorText 落兜底文案——源 readableIpcError「剥不出用兜底」同语义） */
function decodeEditImage(
  payload: CaptureEditImagePayload
): Promise<{ payload: CaptureEditImagePayload; image: HTMLImageElement }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ payload, image })
    image.onerror = () => reject(new Error())
    image.src = payload.dataUrl
  })
}

/** 错误 → 窗内可呈现文案：IPC 失败分支以 Error(result.error) 上抛（主进程已本地
 *  化的文案，toApiResult 包装约定），message 原样呈现；空 message（解码失败、
 *  stage 未就绪等内部哨兵）与非 Error 一律退兜底文案 */
function editErrorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}

function initialHistoryOf(payload: CaptureEditImagePayload): EditorHistory {
  return {
    past: [],
    present: {
      annotations: [],
      view: { originX: 0, originY: 0, width: payload.width, height: payload.height }
    },
    future: []
  }
}

function EditorWindow(): React.JSX.Element {
  const copy = useCopy(SCREENSHOT_EDITOR_COPY)
  const observeToolbar = useCallback((node: HTMLElement | null) => {
    if (!node || !HIDDEN_TITLEBAR_CHROME) return
    const observer = new ResizeObserver(() => {
      const height = node.getBoundingClientRect().height
      // 页面缩放可能只改变 CSS 宽度，仍需通知主进程按当前 zoomFactor 重算。
      window.api.screenshot.setEditorToolbarHeight(height)
    })
    observer.observe(node, { box: 'border-box' })
    return () => observer.disconnect()
  }, [])

  // 建窗 query 的显示缩放系数（主进程按图幅与工作区现算，只缩不放）；缺省/非法
  // 回退 1（空槽默认度量开窗的兜底，画布可能溢出可视区由滚动容器承接）
  const scale = useMemo(() => {
    const raw = Number.parseFloat(new URLSearchParams(window.location.search).get('scale') ?? '')
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1) : 1
  }, [])

  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [captureId, setCaptureId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [history, setHistory] = useState<EditorHistory | null>(null)
  const [tool, setTool] = useState<EditorToolId>('rectangle')
  /** 马赛克模式（反馈轮一：rect 选区框选 / brush 画笔涂抹），默认选区（先有形态） */
  const [mosaicMode, setMosaicMode] = useState<'rect' | 'brush'>('rect')
  /** 裁剪独立栈长度（Stage 上报，审查低-4：驱动裁剪态撤销/重做钮可用态） */
  const [cropStack, setCropStack] = useState<{ past: number; future: number }>({
    past: 0,
    future: 0
  })
  const [weightIndex, setWeightIndex] = useState(1)
  const [color, setColor] = useState<AnnotationColor>(COLOR_PALETTE[0])
  const [fontSizeIndex, setFontSizeIndex] = useState(1)
  const [exportError, setExportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 覆盖 state 提交前的同步窗口，并守住导出到续编完成的整个事务。
  const busyRef = useRef(false)
  const [flash, setFlash] = useState<{ text: string; fading: boolean } | null>(null)
  const flashTimers = useRef<number[]>([])
  const stageHandleRef = useRef<AnnotationStageHandle | null>(null)

  // ===== 取图链（挂载即取；StrictMode 双挂载下旧跑以 cancelled 作废） =====
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await toApiResult(window.api.screenshot.getEditImage())
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error)
        return
      }
      try {
        const { payload, image: decoded } = await decodeEditImage(result.data)
        if (cancelled) return
        setImage(decoded)
        setCaptureId(payload.captureId)
        setHistory(initialHistoryOf(payload))
      } catch (error) {
        if (cancelled) return
        setLoadError(editErrorText(error, storeCopy().failed))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const id of flashTimers.current) window.clearTimeout(id)
    }
  }, [])

  const view = history?.present.view ?? null
  const annotations: Annotation[] = history?.present.annotations ?? []
  const canUndo = (history?.past.length ?? 0) > 0
  const canRedo = (history?.future.length ?? 0) > 0

  // ===== 快照栈：任何标注/视口变更产生新快照（撤销/重做整体回放） =====
  function commitSnapshot(next: EditorSnapshot): void {
    if (busyRef.current) return
    setHistory((h) =>
      h ? { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] } : h
    )
  }

  function handleAnnotationsChange(next: Annotation[]): void {
    if (!history) return
    commitSnapshot({ ...history.present, annotations: next })
  }

  function handleCropConfirm(selection: {
    x: number
    y: number
    width: number
    height: number
  }): void {
    if (!history) return
    commitSnapshot(applyCropFrame(history.present.view, selection, history.present.annotations))
  }

  // 撤销/重做路由（反馈轮一）：裁剪态 → 选区独立栈（经 Stage 句柄——撤「上次框选」，
  // 会话期瞬态不进全局快照栈）；其余 → 全局快照栈
  function handleUndo(): void {
    if (busyRef.current) return
    if (tool === 'crop') {
      stageHandleRef.current?.cropUndo()
      return
    }
    setHistory((h) =>
      h && h.past.length > 0
        ? {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future]
          }
        : h
    )
  }

  function handleRedo(): void {
    if (busyRef.current) return
    if (tool === 'crop') {
      stageHandleRef.current?.cropRedo()
      return
    }
    setHistory((h) =>
      h && h.future.length > 0
        ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
        : h
    )
  }

  // 裁剪栈长度上报接收（审查低-4）：useCallback 稳定引用 + 等值短路（同值返回原
  // state，React 跳过重渲染）——断开「新回调引用 → effect 重跑 → setState → 新
  // 渲染」的循环链
  const handleCropStackChange = useCallback((past: number, future: number) => {
    setCropStack((s) => (s.past === past && s.future === future ? s : { past, future }))
  }, [])

  // 快捷键（反馈轮一建、轮二修订）：⌘/Ctrl+Z 撤销、⌘/Ctrl+Shift+Z 重做（mac ⌘ /
  // win·linux Ctrl 双识别）；文本编辑中豁免（textarea 聚焦时不拦截，交原生文本撤销）；
  // Esc 裁剪态一键直退（清选区栈 + 回矩形工具）。effect 不带依赖数组——每次渲染重挂
  // 保证闭包现值（编辑窗小场景，注册开销可忽略）
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (busyRef.current) return
      const target = e.target as HTMLElement | null
      const editingText =
        target !== null && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (editingText) return
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (e.key === 'Escape' && tool === 'crop') {
        // 反馈轮二：Esc 一键直退裁剪（清栈 + 回矩形），不再双段清选区
        stageHandleRef.current?.cancelCrop()
        setTool('rectangle')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // ===== inline 成功反馈（头部位短文案，2.1s 起淡出、2.6s 移除；不弹浮层） =====
  function showFlash(text: string): void {
    for (const id of flashTimers.current) window.clearTimeout(id)
    flashTimers.current = []
    setFlash({ text, fading: false })
    flashTimers.current.push(
      window.setTimeout(
        () => setFlash((f) => (f && f.text === text ? { ...f, fading: true } : f)),
        FLASH_FADE_AT
      ),
      window.setTimeout(() => setFlash((f) => (f && f.text === text ? null : f)), FLASH_CLEAR_AT)
    )
  }

  /** 产出成功后续编（见模块头注）：重取本窗会话换新 captureId，标注已烘入成品故清零。
   *  返回尺寸与本窗视口不符时保留防御提示；取图绑定本窗会话，其他截图不会替换它。 */
  async function refreshSlotAfterApply(): Promise<void> {
    const result = await toApiResult(window.api.screenshot.getEditImage())
    if (!result.ok) throw new Error(result.error)
    const payload = result.data
    const switched =
      view !== null && (payload.width !== view.width || payload.height !== view.height)
    const { image: decoded } = await decodeEditImage(payload)
    setImage(decoded)
    setCaptureId(payload.captureId)
    setHistory(initialHistoryOf(payload))
    if (switched) showFlash(copy.slotSwitched)
  }

  async function handleExport(kind: 'copy' | 'download'): Promise<void> {
    if (!captureId || busyRef.current) return
    const handle = stageHandleRef.current
    if (!handle) return
    busyRef.current = true
    setBusy(true)
    setExportError(null)
    try {
      const dataUrl = handle.exportPng()
      if (!dataUrl) throw new Error()
      if (kind === 'copy') {
        const result = await toApiResult(window.api.screenshot.editCopy({ captureId, dataUrl }))
        if (!result.ok) throw new Error(result.error)
        showFlash(copy.copied)
      } else {
        const result = await toApiResult(window.api.screenshot.editDownload({ captureId, dataUrl }))
        if (!result.ok) throw new Error(result.error)
        showFlash(format(copy.saved, { file: result.data.fileName }))
      }
      await refreshSlotAfterApply()
    } catch (error) {
      setExportError(editErrorText(error, copy.failed))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // ===== 取图前空态 / 失败态（如实呈现，不伪造内容） =====
  if (!image || !view || !history) {
    return (
      <EditorShell className="chrome-capture-editor chrome-capture-editor-boot">
        <span
          className={loadError ? 'chrome-capture-editor-boot-error' : undefined}
          role={loadError ? 'alert' : 'status'}
        >
          {loadError ?? copy.loading}
        </span>
      </EditorShell>
    )
  }

  const copyLabel = copy.copy
  const downloadLabel = copy.download

  return (
    <EditorShell
      inert={busy}
      aria-busy={busy}
      className={`chrome-capture-editor${HIDDEN_TITLEBAR_CHROME ? ' chrome-capture-editor-chrome-custom' : ''}`}
    >
      <header ref={observeToolbar} className="chrome-capture-editor-topbar">
        <EditorToolbar
          tool={tool}
          onToolChange={setTool}
          mosaicMode={mosaicMode}
          onMosaicModeChange={setMosaicMode}
          weightIndex={weightIndex}
          onWeightIndexChange={setWeightIndex}
          color={color}
          onColorChange={setColor}
          fontSizeIndex={fontSizeIndex}
          onFontSizeIndexChange={setFontSizeIndex}
          canUndo={tool === 'crop' ? cropStack.past > 0 : canUndo}
          canRedo={tool === 'crop' ? cropStack.future > 0 : canRedo}
          cropLocked={tool === 'crop'}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
        <div className="chrome-capture-editor-actions">
          {flash && (
            <span
              className={`chrome-capture-editor-flash${flash.fading ? ' is-fading' : ''}`}
              role="status"
            >
              {flash.text}
            </span>
          )}
          <button
            type="button"
            className="chrome-capture-editor-iconbtn"
            disabled={busy}
            aria-label={copyLabel}
            title={copyLabel}
            onClick={() => void handleExport('copy')}
          >
            <Copy size={16} />
          </button>
          <button
            type="button"
            className="chrome-capture-editor-iconbtn"
            disabled={busy}
            aria-label={downloadLabel}
            title={downloadLabel}
            onClick={() => void handleExport('download')}
          >
            <Download size={16} />
          </button>
        </div>
      </header>
      {exportError && (
        <div className="chrome-capture-editor-errorbar" role="alert">
          {exportError}
        </div>
      )}
      <main className="chrome-capture-editor-canvas">
        {/* key=captureId：产出成功续编后重挂清 Stage 内部草稿/选区/文本编辑态 */}
        <AnnotationStage
          key={captureId ?? 'boot'}
          ref={stageHandleRef}
          image={image}
          view={view}
          scale={scale}
          tool={tool}
          mosaicMode={mosaicMode}
          weightIndex={weightIndex}
          color={color}
          fontSizeIndex={fontSizeIndex}
          annotations={annotations}
          onAnnotationsChange={handleAnnotationsChange}
          onCropConfirm={handleCropConfirm}
          onCropExit={() => setTool('rectangle')}
          onCropStackChange={handleCropStackChange}
        />
      </main>
    </EditorShell>
  )
}

export default EditorWindow
