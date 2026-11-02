---
description: Windows Electron 最小化工具窗重新打开要先 restore，再 focus；focus 本身不还原
tags: [electron, windows, window, minimize, focus]
---

# 最小化窗口重新打开要先还原再聚焦

Windows Electron 39.8.10 实测：窗口 minimize 后调用 focus，isMinimized 仍为 true；调用 restore 后再 focus，窗口才还原。

当原先禁止最小化的工具窗新增最小化能力时，需要同时核对单例打开路径。已就绪窗口应先判断 isMinimized，必要时 restore，再 focus；不重建窗口，避免丢失正在编辑的内容。设置窗和截图编辑窗已按此处理，测试覆盖还原先于聚焦。
