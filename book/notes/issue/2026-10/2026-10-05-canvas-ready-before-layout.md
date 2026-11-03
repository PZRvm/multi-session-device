---
description: 投屏 status 可先于 layout 就绪（format 与 ResizeObserver 的 containerSize 双异步入参有竞态窗口），期间画布槽 0×0 画面不可见且输入被几何拒收；屏幕休眠节流下窗口可拉长到秒级以上
tags: [renderer, device-canvas, race, resize-observer]
status: resolved
---

# 画布 ready 可早于 layout：短暂"已连接但不可见"

- **问题**: `DeviceCanvas` 的 `layout` 由 `format`（流状态消息异步到达）与 `containerSize`（ResizeObserver 异步首回调）共同决定。`useDeviceScreen` 的 `status === 'ready'` 可在这两者之前翻真：此窗口内 `CanvasSlot` 尺寸为 0（画面解码着但不可见）、`layoutRef` 为 null（`normalizedAt` 返回 null，触控被几何拒收）。正常前台窗口窗口极短（毫秒级，肉眼难察）；**宿主屏幕休眠/窗口被节流时可拖到 20s 以上**（2026-10-05 验收实测，配合 caffeinate 后恢复毫秒级）。
- **复现**: 起投屏后立即（或屏幕休眠状态下）读 `__msdCanvas.status === 'ready'` 同时读画布 DOM 尺寸——status 已 ready、canvas 槽 0×0。休眠场景：`pmset` 显示 displaysleep 到期后跑同样探针，layout 长时间 null。
- **建议方向**: Stage mount 时同步量一次初始尺寸（`getBoundingClientRect` 直接 set containerSize，ResizeObserver 只负责后续变化）；或 layout 为 null 且 status ready 时给连接浮层加"正在排版"过渡，避免静默 0×0。属既有观察者驱动的模式（非外框引入），外框只是让 0×0 更显眼。

## 2026-10-09 修复

挂载时在 layout effect 同步测量容器内容区域，ResizeObserver 负责后续变化；流、格式和非零布局都可用才开放输入及旋转。连接已就绪但布局不可用时显示“正在准备画面”。

新增 4 项回归在旧实现全部失败，相关 17 项通过。隔离 Electron 39.8.10 延迟首个 observer 回调：旧组件在 768×788 容器内仍为 0×0，新组件立即得到 330.30×734；归零、恢复、缩窗和横向平板切换通过，4 个原生鼠标采样的归一化误差小于 0.002。测试控制流状态及视频测试图，未覆盖真实解码或系统休眠。

原竞态已修复；review 另发现“已有按下状态后布局归零可能漏释放”，独立记录在 [修复轮 review 留项](2026-10-09-remaining-fixes-review-findings.md)，本轮不扩展修复。见 [计划](../../../plans/2026-10-09-remaining-issue-fixes.md)。
