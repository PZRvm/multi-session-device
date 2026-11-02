---
description: Electron 原生按钮安全区不仅要读取 env，内部 flex 也必须允许收缩，否则宽左栏仍会把 Logcat 挤进窗口按钮区
tags: [electron, windows, titlebar, flex, overlap, scaling]
---

# 读取原生按钮安全区后，内部布局也要允许收缩

- 场景：Windows 使用 hidden 标题栏与 titleBarOverlay，将应用按钮放在原生窗口按钮左侧。
- 原因：env 只约束容器宽度，不约束不可收缩的子项。主窗 500px、固定左区 420px 时，安全区只有 364px，Logcat 仍会排到 420–450px。jsdom 没有排版引擎，组件测试不会发现这个越界。
- 怎么用：安全区优先使用 `titlebar-area-x` / `titlebar-area-width`，固定像素只作 fallback；左区允许 flex 收缩并设置 min-width:0，右区保留按钮最小空间。真实 Electron 验收要交叉组合“dock 收起 + 宽左栏 + 窄主窗”，不能只在 dock 展开后的大窗口里遍历左栏宽度。
- 实测：本项目 Electron 39.8.10 在 900px 窗口给出的原生按钮占宽为 136px，与 138px fallback 不同；100%/125%/150% 均应以实际安全区为准。缩放后的 DIP 可能有 1px 舍入差。
