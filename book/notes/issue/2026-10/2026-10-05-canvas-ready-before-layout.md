---
description: 投屏 status 可先于 layout 就绪（format 与 ResizeObserver 的 containerSize 双异步入参有竞态窗口），期间画布槽 0×0 画面不可见且输入被几何拒收；屏幕休眠节流下窗口可拉长到秒级以上
tags: [renderer, device-canvas, race, resize-observer]
---

# 画布 ready 可早于 layout：短暂"已连接但不可见"

- **问题**: `DeviceCanvas` 的 `layout` 由 `format`（流状态消息异步到达）与 `containerSize`（ResizeObserver 异步首回调）共同决定。`useDeviceScreen` 的 `status === 'ready'` 可在这两者之前翻真：此窗口内 `CanvasSlot` 尺寸为 0（画面解码着但不可见）、`layoutRef` 为 null（`normalizedAt` 返回 null，触控被几何拒收）。正常前台窗口窗口极短（毫秒级，肉眼难察）；**宿主屏幕休眠/窗口被节流时可拖到 20s 以上**（2026-10-05 验收实测，配合 caffeinate 后恢复毫秒级）。
- **复现**: 起投屏后立即（或屏幕休眠状态下）读 `__msdCanvas.status === 'ready'` 同时读画布 DOM 尺寸——status 已 ready、canvas 槽 0×0。休眠场景：`pmset` 显示 displaysleep 到期后跑同样探针，layout 长时间 null。
- **建议方向**: Stage mount 时同步量一次初始尺寸（`getBoundingClientRect` 直接 set containerSize，ResizeObserver 只负责后续变化）；或 layout 为 null 且 status ready 时给连接浮层加"正在排版"过渡，避免静默 0×0。属既有观察者驱动的模式（非外框引入），外框只是让 0×0 更显眼。
