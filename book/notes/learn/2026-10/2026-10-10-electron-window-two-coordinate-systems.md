---
description: Electron 窗口尺寸有两套坐标系——getBounds/setSize 是外框、getContentBounds/setContentSize 是内容；跨平台做 UI 布局钳制时混用两套会差一个帧差宽度（Windows 14-16px），且测试替身常把「外框=内容」烧进假设掩盖缺陷
created: 2026-10-10
tags: [electron, windows, layout, testing]
---

# Electron 窗口尺寸双坐标系——布局钳制必须统一口径

## 坑

日志面板的 dock 拉宽钳制（issue 2026-10-10-three-features-merge-code-review P2-1）：renderer 按内容宽算需求（`innerWidth`、列表+日志栏+画布保底），主进程却用 `getBounds().width` 比较并用 `setSize()` 拉宽——这是**外框**坐标。macOS 上外框≈内容宽（帧差 0），七轮真机验收全部通过；Windows 外框含不可见边框，帧差约 14-16px：拉宽到「外框=需求」后内容宽仍缺帧差，dock 不渲染，再点入口时 `bounds.width == minWidth` 不满足 `<` 条件不再拉宽——**死端，且只在 Windows 必现**。

## 规则

- renderer 的布局需求（`innerWidth`/DOM 测量）天然是内容坐标；主进程与之比较、钳制、拉宽必须全程 `getContentBounds()`/`setContentSize()`。
- 用户拖拽的 `will-resize` 事件给的 `newBounds` 是外框——折算内容宽再比（帧差 = 当前 `getBounds().width − getContentBounds().width`）。
- 尺寸取整照旧：分数缩放下 bounds 带 `.5`，`setContentSize` 同样只收整数。

## 为什么测试没拦住

App 测试的 `setDockState` mock 把「main 拉宽」模拟成 `window.innerWidth = minWidth`——等于把「外框=内容宽」假设烧进了测试，帧差场景结构性不可见。mock 窗口行为时，替身要能分别设置外框/内容两组尺寸（本次 window/logcat 测试替身即如此），否则被 mock 掉的正是出 bug 的那条缝。

## 关联

- 修复与测试：`src/main/window/logcat.ts` + `src/main/window/__tests__/logcat.test.ts`（帧差 14 的用例直接复现旧口径放行的场景）。
- 姊妹坑：macOS 分数缩放 `getBounds` 出 `.5` 值导致 setSize 参数转换失败（learn 2026-10-10-logcat-verify-pitfalls）——同属「窗口尺寸口径」家族。
