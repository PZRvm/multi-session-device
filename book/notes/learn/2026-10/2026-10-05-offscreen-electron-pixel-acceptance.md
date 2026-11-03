---
description: jsdom 证不了像素对齐——离屏 Electron + 页内 getBoundingClientRect 几何断言 + capturePage 序列帧，一套临时 harness 覆盖状态矩阵、动画漂移与主题可见性
tags: [electron, testing, visual-acceptance, layout, styled-components]
---

# 离屏 Electron harness 做像素级视觉验收

- **Scenario**: renderer 组件改了布局（对齐、槽位、动画）且验收要求「真实窗口核验像素结果」；jsdom 无排版引擎，只能证语义不能证像素。
- **Why**: harness 放 `node_modules/.msd-harness/`（天然被 git 忽略，esbuild 从该目录向上解析 node_modules 依赖也顺）。esbuild `--bundle --jsx=automatic --alias:@shared=src/shared` 直接打包真实组件，不经过 vite 也能用别名。主题不必全局切换：`themeCssVariables(system, mode)` 返回的 CSS 变量 record 直接 spread 到容器 `style` 上，变量随级联生效，一页同时渲染三系统 × 亮暗六个区块。Electron 主进程用 `webPreferences: { offscreen: true, contextIsolation: true }` + `loadFile`，页内测量结果经 `console-message` 事件回传（`##标记##` 前缀 JSON），截图用 `webContents.capturePage()` 连拍序列帧。页内几何比截图肉眼强：`getBoundingClientRect` 算各图标中心极差、槽位尺寸，`requestAnimationFrame` 多帧采样动画期中心漂移，判据可写成 `< 0.5px` 的硬阈值（实测改造后全部 0.00px）。
- **怎么用**: 验收矩阵一次渲染（状态 × 主题 × 选中 × 长名/窄容器/错误副行）→ 页内几何断言 → capturePage 帧留档给肉眼/视觉模型复核亮暗与选中可见性。offscreen 模式 `capturePage` 只截视口大小，页面多高窗口就开多高。harness 用完留在 node_modules 里自生自灭，不污染仓库；真要常备再考虑升格为 scripts 下的固定工具。
