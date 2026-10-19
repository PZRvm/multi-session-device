---
description: 已修复录屏结果与 Logcat 重叠——移除顶部结果条，完成结果走原生 dialog，当前计时与日志同组排列
created: 2026-10-16
status: resolved
tags: [recording, logcat, layout, ui]
---

# 录屏结果条与 Logcat 入口重叠

用户截图显示结果区右上角的 Logcat 按钮覆盖结果条。`src/renderer/src/App.tsx` 将 RecordingTasks 放在 canvas-content 之前，而 `.log-toggle` 相对 canvas-area 以 top/right 10px 绝对定位；结果列表出现后，按钮仍留在整个画布上沿。

用户已确认：完成结果改为原生 dialog，移除上方结果条；当前设备计时放在 Logcat 左侧同一工具组，停止后显示正在生成，保存成功再提示；失败提供重试或稍后处理并保留素材。此为方案确认时的决定，后续实施结果见下。见 [调研报告](../../think-report/20261016173327-录屏计时与提示交互.md)。

2026-10-16 处置：已移除 RecordingTasks 的 App 挂载及旧组件；当前设备 Indicator 与日志按钮由同一个 flex 工具组排列（间距 12px），结果在 main 串行原生 dialog 中呈现。1100/700 宽构建界面和原生成功结果可访问树已核对，1291 项测试通过（6 项原有跳过），build/typecheck/lint/格式通过。详见 [交互 plan](../../../plans/2026-10-16-recording-interactions.md)。此 issue 关闭不表示长录同步问题已解决。
