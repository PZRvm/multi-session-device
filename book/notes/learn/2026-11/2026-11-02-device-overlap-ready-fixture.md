---
description: 检查投屏与窗口控件遮挡时必须提供 ready 视频尺寸，连接中占位和 DOM 结构测试无法覆盖外框缩放
tags: [electron, screen, layout, resizeobserver, overlap, testing]
---

# 投屏遮挡要用有尺寸的 ready 画面验证

- 场景：原生窗口控件悬在画布上，需判断手机是否进入顶部控制区。
- 原因：连接中 fixture 没有视频尺寸，布局返回 null，不会出现手机外框；截图即使显示 Logcat 位置正确，也不能证明设备画面不会被遮挡。
- 怎么用：在隔离 Electron 中提供 ready 流格式，测量实际 frame-shell/canvas-slot 与控件区的窗口坐标，检查外框顶部、底边、视频比例与工具条。覆盖真机、模拟器、横竖屏及短窗。屏幕格式 fixture 只证明布局，不能冒充真实解码或触摸验证。
- ResizeObserver 在窗口变更后异步提交；验证应等待几何条件收敛并设置超时，不依赖固定 350ms 或少量微任务拍数。
