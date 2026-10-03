---
description: 主窗恢复 macOS 原生红绿灯，保留无标题文字的板头布局，移除自绘按钮和专用 IPC
status: completed
created: 2026-10-04
---

# 主窗原生红绿灯

用户 2026-10-04 明确要求：左上角使用 macOS 原生按钮，替换渲染层自绘按钮。

## 需求与分析

当前主窗使用 `hiddenInset`，但主动隐藏原生按钮；BoardHead 自绘三灯，焦点和窗口操作经专用 IPC 同步。替换范围为主窗配置、板头、专用 IPC 和现有板头测试。不改设备业务、向导窗、外观切换、非 macOS 窗口框架，也不增加完整标题文字栏。

## 设计

- 主窗保留 `titleBarStyle: 'hiddenInset'`，设置 `trafficLightPosition: { x: 14, y: 12 }`，移除隐藏按钮和 focus/blur 推送。按钮外观、悬停、失焦及关闭/最小化/全屏行为由 macOS 管理。
- BoardHead 的 macOS 分支只留 60px 无交互占位，移除三灯图形、颜色、点击逻辑及焦点订阅。40px 拖拽带和右侧控件沿用现状。
- 删除仅供自绘按钮使用的 `main/window/controls.ts`、`preload/api/window.ts`，同步移除注册、API 导出和三个 shared 通道；平台字段仍用于板头分支。
- 现有 BoardHead 测试改为验证 macOS 没有页面窗口按钮、非 macOS 标题回归，保留外观和计数断言。

## 验证与收尾

运行 typecheck、lint、prettier 和完整测试；启动新构建，在真实 macOS 窗口检查原生按钮及窗口行为，验证页面没有重复按钮。原生按钮不在 renderer 截图内，视觉验证使用系统窗口截图。按 review 清单检查范围和边界；完成后回写 stage 对应步骤、learn 与本 plan，刷新索引。

## 完成记录

主窗恢复原生三灯，BoardHead 只留占位；自绘按钮及专用 IPC 全部移除。typecheck、lint、prettier 通过，7 个测试文件共 49 项通过。新启动的 6174 实例中，系统可访问性树识别关闭/全屏/最小化按钮，均位于 HTML 内容树外；原生全屏及菜单退出、关闭后重新激活建窗已验证。最小化点击后，观察工具会激活应用，未独立确认最小化持续状态。运行时确认页面自绘按钮为 0、板头高 40px、preload 不再暴露 window 控制 API。窗口截图未捕获三灯图层，不以截图断言其颜色。按八项 review 清单检查，未发现本轮新增问题。
