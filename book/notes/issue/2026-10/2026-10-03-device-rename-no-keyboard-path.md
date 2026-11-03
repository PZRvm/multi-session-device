---
description: DeviceRow 行内重命名只有鼠标双击一条入口，键盘用户（F2/Enter 二次）无法发起重命名
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：DeviceRow 已有 双击/F2/选中态 Enter 三个重命名入口（aria-keyshortcuts="F2"）。
# 行内重命名无键盘路径

- **Observed**: 2026-10-03 stage 03 Phase 5 review 发现：`DeviceRow` 的重命名入口只有 `onDoubleClick`。行本身可 Tab 聚焦、Enter 可选中，但从键盘无法发起重命名——纯键盘用户（或将来的辅助技术用户）改不了名。
- **Reproduction**: Tab 聚焦设备行 → 按 F2 / 再按 Enter → 无任何反应。
- **Suggested direction**: 行 keydown 加 `F2` 进入重命名（Windows 惯例），或选中态下再按 Enter 进入；macOS 用户语义可用 `⌘R`……最小改法是 F2 + aria 说明了。改动局限 DeviceRow 一个文件。

严重级：P3（stage 03 mock 壳可后补；进 stage 05 可用性打磨时一起过一遍键盘地图）。

## 跟进（2026-10-05）——已修

`DeviceRow` 行 keydown 补两条键盘入口（commit 08e7428，plan 2026-10-05-device-store-issue-batch）：**F2**（Windows 惯例，任意可重命名状态）与**选中态再按 Enter**（macOS Finder 惯例；未选中 Enter 维持仅选中）；复用 `startRename` 的 creating/deleting 守卫，行携带 `aria-keyshortcuts="F2"`。键盘地图的完整梳理仍按原计划留给 stage 05。测试在案：F2 进入/回填/聚焦、选中态 Enter、未选中 Enter 不进重命名、creating/deleting 下 F2 无效、重命名中输入框按键不触发行级语义。
