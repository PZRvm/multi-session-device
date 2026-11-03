import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCREENSHOT_EDITOR_COPY, format } from '@shared/i18n'
import type { CaptureEditImagePayload } from '@shared/screenshot-editor'
import type { Annotation } from '../editorConstants'

const copy = SCREENSHOT_EDITOR_COPY['zh-CN']

// AnnotationStage 桩（plan T4 约定：绘制边界 mock，像素效果由 T6 真实画布验收）：
// 留 handle 接口（exportPng 可控）+ 记录最近 props 供用例驱动 onAnnotationsChange
const stageMock = vi.hoisted(() => ({
  exportPng: vi.fn<() => string | null>(),
  lastProps: null as Record<string, unknown> | null
}))

vi.mock('../AnnotationStage', async () => {
  const React = await import('react')
  return {
    AnnotationStage: React.forwardRef(function AnnotationStage(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>
    ) {
      stageMock.lastProps = props
      React.useImperativeHandle(ref, () => ({
        exportPng: (): string | null => stageMock.exportPng(),
        cropUndo: () => {},
        cropRedo: () => {},
        cancelCrop: () => {}
      }))
      return React.createElement('div', { 'data-testid': 'annotation-stage' })
    })
  }
})

import EditorWindow from '../EditorWindow'

const EXPORT_PNG = 'data:image/png;base64,RURJVA=='

const getEditImage = vi.fn<() => Promise<CaptureEditImagePayload>>()
const editCopy = vi.fn<(payload: { captureId: string; dataUrl: string }) => Promise<void>>()
const editDownload =
  vi.fn<(payload: { captureId: string; dataUrl: string }) => Promise<{ fileName: string }>>()

// jsdom 不解码图片：替换全局 Image。src 赋值后以真微任务结算 onload/onerror
// （decodeEditImage 先挂 handler 再赋 src，时序兼容）
let decodeFails = false
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private srcText = ''
  get src(): string {
    return this.srcText
  }
  set src(value: string) {
    this.srcText = value
    void Promise.resolve().then(() => {
      if (decodeFails) this.onerror?.()
      else this.onload?.()
    })
  }
}

const payload = (over: Partial<CaptureEditImagePayload> = {}): CaptureEditImagePayload => ({
  captureId: 'cap-1',
  dataUrl: 'data:image/png;base64,aW1n',
  width: 800,
  height: 600,
  ...over
})

const textAnnotation: Annotation = {
  id: 'a1',
  kind: 'text',
  x: 10,
  y: 10,
  text: '标注',
  fontSize: 42,
  fill: '#fa5151'
}

/** 排干取图/产出 promise 链（真微任务链一次 await 即排空；fake timer 下顺带推进 0ms） */
const flush = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** 经 Stage 桩的受控提交入口画一笔（快照栈落一条 → 撤销可用） */
const drawAnnotation = (): void => {
  const props = stageMock.lastProps as { onAnnotationsChange: (a: Annotation[]) => void } | null
  if (!props) throw new Error('AnnotationStage 未挂载')
  act(() => {
    props.onAnnotationsChange([textAnnotation])
  })
}

const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('Image', FakeImage)
  decodeFails = false
  stageMock.exportPng.mockReturnValue(EXPORT_PNG)
  ;(window as { api?: unknown }).api = {
    platform: 'win32',
    screenshot: { getEditImage, editCopy, editDownload }
  }
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as { api?: unknown }).api
})

describe('EditorWindow 取图链', () => {
  it('载入失败（IPC 错误）：窗内如实呈现主进程文案，停留空态不进画布', async () => {
    getEditImage.mockRejectedValue(new Error('截图已过期：设备已截新图'))
    render(<EditorWindow />)
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('截图已过期：设备已截新图')
    expect(screen.queryByTestId('annotation-stage')).toBeNull()
  })

  it('载入失败（解码失败）：非 IPC 异常退域字典兜底文案', async () => {
    getEditImage.mockResolvedValue(payload())
    decodeFails = true
    render(<EditorWindow />)
    await flush()
    expect(screen.getByRole('alert').textContent).toBe(copy.failed)
  })

  it('载入成功：进入画布，空历史的撤销/重做禁用', async () => {
    getEditImage.mockResolvedValue(payload())
    render(<EditorWindow />)
    await flush()
    expect(screen.getByTestId('annotation-stage')).toBeTruthy()
    expect(screen.queryByText(copy.loading)).toBeNull()
    expect(button(copy.undo).disabled).toBe(true)
    expect(button(copy.redo).disabled).toBe(true)
  })
})

describe('EditorWindow 产出链', () => {
  it('导出到续编取图完成期间锁定编辑与历史，失败后恢复', async () => {
    let rejectDownload!: (error: Error) => void
    getEditImage.mockResolvedValue(payload())
    editDownload.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDownload = reject
        })
    )
    const { container } = render(<EditorWindow />)
    await flush()
    drawAnnotation()
    fireEvent.click(button(copy.download))
    await flush()
    expect(container.firstElementChild?.hasAttribute('inert')).toBe(true)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(stageMock.lastProps?.annotations).toEqual([textAnnotation])
    drawAnnotation()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(stageMock.lastProps?.annotations).toEqual([textAnnotation])
    await act(async () => rejectDownload(new Error('磁盘不可写')))
    await flush()
    expect(container.firstElementChild?.hasAttribute('inert')).toBe(false)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(stageMock.lastProps?.annotations).toEqual([])
  })

  it('IPC 成功后续编取图尚未完成时仍锁定，完成后可继续编辑', async () => {
    let resolveImage!: (value: CaptureEditImagePayload) => void
    getEditImage.mockResolvedValueOnce(payload()).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImage = resolve
        })
    )
    editCopy.mockResolvedValue(undefined)
    const { container } = render(<EditorWindow />)
    await flush()
    fireEvent.click(button(copy.copy))
    await flush()
    expect(container.firstElementChild?.hasAttribute('inert')).toBe(true)
    await act(async () => resolveImage(payload({ captureId: 'cap-2' })))
    await flush()
    expect(container.firstElementChild?.hasAttribute('inert')).toBe(false)
    drawAnnotation()
    expect(stageMock.lastProps?.annotations).toEqual([textAnnotation])
  })

  it('旧 id 导出失败（截图已过期）：错误条呈现、编辑态原样保留', async () => {
    getEditImage.mockResolvedValue(payload())
    editCopy.mockRejectedValue(new Error('截图已过期'))
    render(<EditorWindow />)
    await flush()
    drawAnnotation()
    expect(button(copy.undo).disabled).toBe(false)
    fireEvent.click(button(copy.copy))
    await flush()
    // 产出以编辑窗持有的旧 captureId 对账
    expect(editCopy).toHaveBeenCalledWith({ captureId: 'cap-1', dataUrl: EXPORT_PNG })
    expect(screen.getByRole('alert').textContent).toBe('截图已过期')
    expect(screen.queryByRole('status')).toBeNull()
    // 保留编辑态：画布仍在、撤销历史未清、产出钮复员（busy 释放）
    expect(screen.getByTestId('annotation-stage')).toBeTruthy()
    expect(button(copy.undo).disabled).toBe(false)
    expect(button(copy.copy).disabled).toBe(false)
  })

  it('产出成功续编：换新 captureId、历史清零，继续下载用新 id 对账', async () => {
    getEditImage
      .mockResolvedValueOnce(payload()) // 挂载取图
      .mockResolvedValueOnce(payload({ captureId: 'cap-2' })) // 复制后续编
      .mockResolvedValueOnce(payload({ captureId: 'cap-2' })) // 下载后续编
    editCopy.mockResolvedValue(undefined)
    editDownload.mockResolvedValue({ fileName: 'device-20261102-101010.png' })
    render(<EditorWindow />)
    await flush()
    drawAnnotation()
    expect(button(copy.undo).disabled).toBe(false)
    fireEvent.click(button(copy.copy))
    await flush()
    // 成功 flash + 单槽换新图（标注已烘入成品 → 撤销栈重置）
    expect(editCopy).toHaveBeenCalledWith({ captureId: 'cap-1', dataUrl: EXPORT_PNG })
    expect(screen.getByRole('status').textContent).toBe(copy.copied)
    expect(button(copy.undo).disabled).toBe(true)
    // 复制后再下载：用续编后的新 id，不报过期
    fireEvent.click(button(copy.download))
    await flush()
    expect(editDownload).toHaveBeenCalledWith({ captureId: 'cap-2', dataUrl: EXPORT_PNG })
    expect(screen.getByRole('status').textContent).toBe(
      format(copy.saved, { file: 'device-20261102-101010.png' })
    )
  })

  it('产出成功而续编取图失败：成功 flash 保留 + 错误条如实呈现（分别呈现）', async () => {
    getEditImage.mockResolvedValueOnce(payload()).mockRejectedValueOnce(new Error('截图槽位已清空'))
    editCopy.mockResolvedValue(undefined)
    render(<EditorWindow />)
    await flush()
    fireEvent.click(button(copy.copy))
    await flush()
    expect(screen.getByRole('status').textContent).toBe(copy.copied)
    expect(screen.getByRole('alert').textContent).toBe('截图槽位已清空')
  })

  it('续编弱校验：取到并发新截图（尺寸不符）→ flash 换「已切换到最新截图」', async () => {
    getEditImage
      .mockResolvedValueOnce(payload())
      .mockResolvedValueOnce(payload({ captureId: 'cap-9', width: 999 }))
    editCopy.mockResolvedValue(undefined)
    render(<EditorWindow />)
    await flush()
    fireEvent.click(button(copy.copy))
    await flush()
    expect(screen.getByRole('status').textContent).toBe(copy.slotSwitched)
  })

  it('busy 防重复：产出进行中两产出钮禁用，仅一次 IPC', async () => {
    getEditImage.mockResolvedValue(payload())
    let releaseCopy!: () => void
    editCopy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCopy = resolve
        })
    )
    render(<EditorWindow />)
    await flush()
    fireEvent.click(button(copy.copy))
    await flush()
    expect(button(copy.copy).disabled).toBe(true)
    expect(button(copy.download).disabled).toBe(true)
    fireEvent.click(button(copy.copy))
    fireEvent.click(button(copy.download))
    await flush()
    expect(editCopy).toHaveBeenCalledTimes(1)
    expect(editDownload).not.toHaveBeenCalled()
    await act(async () => {
      releaseCopy()
      await vi.advanceTimersByTimeAsync(0)
    })
    // 复员后可再次产出
    expect(button(copy.copy).disabled).toBe(false)
    expect(editCopy).toHaveBeenCalledTimes(1)
  })

  it('卸载清理 flash 定时器：unmount 即 clearTimeout，推进无泄漏', async () => {
    getEditImage
      .mockResolvedValueOnce(payload())
      .mockResolvedValueOnce(payload({ captureId: 'cap-2' }))
    editCopy.mockResolvedValue(undefined)
    const { unmount } = render(<EditorWindow />)
    await flush()
    fireEvent.click(button(copy.copy))
    await flush()
    expect(screen.getByRole('status').textContent).toBe(copy.copied)
    const clearSpy = vi.spyOn(window, 'clearTimeout')
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
  })
})
