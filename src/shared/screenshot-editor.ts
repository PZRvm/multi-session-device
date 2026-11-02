// 截图编辑器·共享载荷契约（结构迁自 multi-session-browser src/shared/capture.ts，
// 本仓库 plan book/plans/2026-11-02-screenshot-editor.md §4）：通道常量登记在
// @shared/ipc-channels 的 IPC_CHANNELS（本仓库单源），此处只持载荷类型。

/**
 * getEditImage 返回（主进程 → 编辑窗）：dataUrl 为该设备缓存 PNG 的 data URL，
 * width/height 为原图像像素尺寸（编辑窗显示缩放与导出 pixelRatio 换算的基准——
 * 显示层缩放不缩放标注语义，标注统一存图像坐标）
 */
export interface CaptureEditImagePayload {
  captureId: string
  dataUrl: string
  width: number
  height: number
}

/**
 * editCopy / editDownload 入参（编辑窗 → 主进程）：dataUrl 为编辑成品 PNG 的
 * data URL（主进程守卫前缀与长度上限，防任意巨串）；captureId 为编辑窗取图时获得
 * 的标识——对账失败（编辑期间同设备又截屏换缓存）如实报「截图已过期」
 */
export interface CaptureEditApplyPayload {
  captureId: string
  dataUrl: string
}
