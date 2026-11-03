---
description: 编辑器续编尺寸校验的单槽注释已于 2026-11-04 改为本窗会话的尺寸异常防御说明
---

# 续编尺寸校验注释仍描述设备单槽模型

- **观察**：本轮阶段 5 评审发现，`src/renderer/src/components/ScreenshotEditor/EditorWindow.tsx` 的 refreshSlotAfterApply 注释仍称尺寸不匹配说明取到了并发新截图。现在 getEditImage 固定本窗快照，新截图不再切换旧窗口数据。
- **复现**：阅读该函数头注，并对照 screenshot 域按 sender 会话取图的实现；尺寸防御校验本身仍保留，没有观察到运行故障。
- **建议方向**：后续单独同步注释，将其解释为返回图像尺寸异常的防御检查；本轮按阶段 5 只记录，不改代码。

关联[计划](../../../plans/2026-11-03-screenshot-editor-per-capture.md)。

## 2026-11-04 修复结果

用户授权单独修复后，refreshSlotAfterApply 的注释改为本窗会话尺寸异常的防御提示，运行逻辑和文案未改。相关 renderer 回归与全仓测试通过。
