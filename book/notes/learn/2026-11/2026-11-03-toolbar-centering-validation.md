---
description: 工具条居中要测实际内容；macOS 原生窗口按钮还需按工具栏高度定位，并用原生窗口截图核验
tags: [css, flex, toolbar, alignment, screenshot-editor]
---

# 工具条居中要测实际工具组的位置

- **场景**：左右两块工具区使用 flex 排列，左侧 `flex: 1` 占剩余空间，内部允许按组换行。
- **原因**：`align-items: center` 只控制交叉轴；工具条容器占满可用宽度，内容仍会按默认主轴排列贴左。上轮仅比较左右容器的纵向中心，漏验了用户要求的水平居中。
- **怎么用**：需要水平居中时显式设置 `justify-content: center`。真实渲染验证应按行计算工具组最左、最右边界的中心，与左侧可用区域中心比较；同时检查最小窗口、宽窗、工具切换、三语和换行，避免只测容器框。


## 原生窗口按钮必须单独核验

`webContents.capturePage()` 不包含 macOS 原生红黄绿按钮。编辑工具条内部对齐通过，并不能证明三灯也居中。本次漏验源于沿用 40px 标题栏的 y=12，而编辑页工具栏至少为 48px。

按[既有像素实测](../2026-10-06-红绿灯垂直居中实测.md)，灯中心约为 position.y + 8。100% 页面缩放时，编辑页初始 y=16；工具栏换行时通过 ResizeObserver 读取 border-box 高度，再以 round(height / 2 - 8) 更新本窗原生按钮。观察器随节点卸载清理，主进程通道限定本编辑窗主 frame。

验收要看包含原生三灯的窗口截图，并覆盖单行、换行和恢复单行。本轮通过原生应用截图确认了这三个状态；Quartz 单窗截图返回空图，因此没有把 capturePage 结果充当原生截图。主进程和 preload 改动后需重启开发进程，再打开编辑窗，单纯刷新 renderer 不会加载新的窗口配置与桥接。


## 页面缩放要区分 CSS px 与窗口 DIP

DOM 的 getBoundingClientRect 返回 CSS px，原生窗口按钮使用 DIP。缩放后的工具栏高度应乘本窗 webContents.getZoomFactor，再用于定位和窗高上界检查。最小高度的 CSS 校验须容纳亚像素误差：80% 缩放实测名义 48px 会成为约 47.998px。

ResizeObserver 观察整个工具栏 border-box；页面缩放可能只改变 CSS 宽度而不改变高度，因此不能只按高度去重。宽窗下 100% → 125% 仍是 48px 高，上报必须保留，才能按新 zoomFactor 重算原生位置。验证须等待 observer/IPC 到达后再取几何，避免把首帧旧位置当作最终结果。
