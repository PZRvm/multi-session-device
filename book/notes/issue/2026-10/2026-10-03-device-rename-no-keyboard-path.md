---
description: DeviceRow 行内重命名只有鼠标双击一条入口，键盘用户（F2/Enter 二次）无法发起重命名
---

# 行内重命名无键盘路径

- **Observed**: 2026-10-03 stage 03 Phase 5 review 发现：`DeviceRow` 的重命名入口只有 `onDoubleClick`。行本身可 Tab 聚焦、Enter 可选中，但从键盘无法发起重命名——纯键盘用户（或将来的辅助技术用户）改不了名。
- **Reproduction**: Tab 聚焦设备行 → 按 F2 / 再按 Enter → 无任何反应。
- **Suggested direction**: 行 keydown 加 `F2` 进入重命名（Windows 惯例），或选中态下再按 Enter 进入；macOS 用户语义可用 `⌘R`……最小改法是 F2 + aria 说明了。改动局限 DeviceRow 一个文件。

严重级：P3（stage 03 mock 壳可后补；进 stage 05 可用性打磨时一起过一遍键盘地图）。
