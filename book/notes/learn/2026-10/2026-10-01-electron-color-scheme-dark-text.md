---
description: Electron renderer 开 color-scheme: light dark 跟随系统进深色后，硬编码的深色文字不可见——主题落地前锁 color-scheme: light
tags: [electron, color-scheme, dark-mode, invisible-text, styled-components, silent-fail, pitfall]
---

# Electron renderer 跟随系统深色 + 硬编码浅色配色 = 文字静默不可见

- **Scenario**: global.css 或根样式写了 `color-scheme: light dark`（跟随系统），而组件里用固定色值（如 `color: #1f2328`）——开发机是深色模式时必现。
- **Why**: `color-scheme: light dark` 让 Chromium 把页面默认背景渲染成深色，但组件里的硬编码深色文字不会跟着翻色，深字配深底，界面"看起来空白"，控制台无任何报错——故障静默。
- **How to apply**: ① 主题系统（tokens + 亮暗双态）落地之前，`color-scheme` 锁 `light` 并给 body 显式背景色，别开跟随系统；② 主题系统落地后，颜色一律走 tokens，禁止组件里散落硬编码色值；③ 冒烟验证别只看"窗口起了"，要截屏看实际渲染（本次就是靠 screencapture 抓出来的）。
