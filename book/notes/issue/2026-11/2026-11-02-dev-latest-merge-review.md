---
description: dev 最近合入评审两项 P2 已修复，窗口最小化恢复经实测确认并修复，附验证结果
created: 2026-11-02
status: resolved
tags: [review, screenshot, editor, race, crop]
---

# dev 最近合入代码评审

范围：`3af2256..44f988a`，覆盖截图编辑器、Windows 主窗与设置窗外观及其接线。基线之前的 Windows 合并与修复已有评审记录，本轮不重复列出。没有评审 `main..dev` 全部历史累计改动。

本轮只记录，不修改实现。确认 2 项 P2；以下结论来自源码路径核对，未完成真实画布复现。

## P2-1：导出等待期间新增的编辑被清掉

- 位置：`src/renderer/src/components/ScreenshotEditor/EditorWindow.tsx:280`，关联 `handleExport` 与下方工具条、画布接线。
- 触发：点击下载后，在 IPC 写盘、重新取图或 Image 解码尚未结束时，继续画标注、移动形状、裁剪或撤销。
- 原因：导出入口先执行 `handle.exportPng()`，随后异步等待；`busy` 只禁用复制和下载按钮，画布、工具条和快捷键仍可修改历史。`refreshSlotAfterApply()` 返回时无条件设置新图与 `initialHistoryOf(payload)`，并通过新 captureId 重挂 Stage。
- 影响：在途新增编辑不在已生成的 PNG 中，也从当前画布及撤销历史中消失。慢磁盘或较大图片会扩大操作窗口。
- 建议：从生成 PNG 到续编完成，锁住画布、工具条和历史快捷键；或者记录编辑代次并保留在途操作。修复轮增加延迟导出时继续编辑的测试；现有窗根测试仅验证导出按钮防重。

## P2-2：裁剪把范围外的马赛克搬入新图

- 位置：`src/renderer/src/components/ScreenshotEditor/editorConstants.ts:216`，关联 `AnnotationStage.tsx` 的 MosaicNode 采样。
- 复现输入：原视口 1000×1000，马赛克 `(x=0,y=0,width=100,height=100)`，裁剪选区 `(x=500,y=500,width=400,height=400)`。
- 实际推导：mosaic 分支对宽高取 min，再 clamp 平移后的位置，返回新图左上角的 `(0,0,100,100)`；原本完全在裁剪范围外的马赛克仍出现。MosaicNode 按新视口与新坐标重新采样，使保留图像中原本未打码的区域被打码。部分相交时同样会扩大覆盖区域。
- 预期：按计划的“保留范围内标注”，无交集区域应消失，部分相交区域只保留交集。
- 建议：先求原区域与裁剪选区的交集，过滤空交集，再平移坐标。现有 `editorConstants.test.ts` 的“马赛克越出选区被夹回新视口内”测试固定了整体搬移行为，修复轮应调整该预期，并补无交集及部分相交用例。

## 待实测项

Windows 设置窗本轮新增最小化能力，但单例打开路径仍只调用 `focus()`；截图编辑窗同样只聚焦。需要真实 Electron 验证“最小化后从入口再次打开”是否还原；尚未确认，未计入缺陷数。

## 已有记录

- [截图编辑器阶段 5 评审](2026-11-02-screenshot-editor-review.md)：导出 state 防重的理论窗口已有记录，本轮不重复。
- [Windows 窄窗 Logcat 越界](2026-11-02-windows-titlebar-narrow-window.md)：已解决，本轮不重复。

## 验证结果

`npm run typecheck` 通过。定向运行编辑窗控制器、主题、截图编辑器、useScreenshot、ScreenshotPopover、BoardHead、SettingsWindow 测试，9 个文件、114 个用例通过。未运行全量测试、构建或真实 Electron 画布验收。`npm run book:index` 通过，零警告、链接可解析。

## 独立修复轮

用户要求全部修复后，按[修复计划](../../../plans/2026-11-02-screenshot-review-fixes.md)处理：

- P2-1：根节点 inert 锁住工具条与画布，同步 busy ref 拦截历史操作与快捷键，锁持续到续编完成，失败也释放；覆盖慢下载失败及续编等待的回归测试。
- P2-2：马赛克与选区求交，空交集移除；测试覆盖右下、左上交集和完全分离、边缘接触，纠正原来的整体搬移预期。
- 待实测项：Electron 39.8.10 在 Windows 上 minimize 后 focus，isMinimized 仍为 true；restore 后变为 false。设置窗和截图编辑窗单例入口已改为必要时先 restore 再 focus，各补一条回归测试。
- 同步 busy ref 也消除了原截图编辑器评审 P3 的 state 提交前导出重入窗口。

修复验证：8 条针对性失败用例先复现，修复后 10 个相关文件、134 项测试通过；lint、build（含 typecheck）通过。真实 Electron 验证最小化恢复及 inert 可阻止后代聚焦，原始结果在本地 `dist/review-fixes/native-results.json`。未重跑全量测试，也未进行完整真实画布像素验收。
