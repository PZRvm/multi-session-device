---
description: 摄像头空清单先核对真实 CLI 格式；Studio 皮肤按固定提交获取，display part 和 quarter-turn 决定渲染及输入几何
tags: [camera, webcam, electron, tcc, skin, gitiles, rotation, geometry]
---

# 空摄像头列表与错位皮肤要先查数据契约

- 场景：CLI 能看到 Mac 相机，应用下拉为空；AVD 已保存 skin.path，工作台却仍显示通用外框。
- 原因：emulator 37.2.12 从旧的 `Camera 'webcam0' is connected to device` 换成友好名称、webcamN 与稳定 id 的新行。旧正则返回空不能证明 TCC 拦截。本轮新鲜 Electron 39 探针已读到 MacBook Pro 相机，权限状态仍 not-determined；枚举与取景须分别验证。
- 皮肤：`-no-window` 加 scrcpy 只带视频，Android Emulator 的皮肤不会进入流。工作台必须读取保存的 skinRef，把真实位图放视频之下。Pixel 7 的 part1 是装饰，part2 `name device` 才是 `(59,58)` 的屏幕；rotation 是 0–3 的 quarter-turn，以 part 锚点转局部坐标。布局与触控共用一个矩形，浮点角点允许极小数值误差，实际框外仍拒绝命中。
- 来源：完整机型资源在 Studio 官方 `platform/tools/adt/idea` 的 device-art-resources。本应用 SDK 没有 skins，不能推断资源不可独立获取。固定提交、白名单目录、逐文件 Git blob 校验避免随分支漂移，也避免解包任意远端 tar 条目。同版 Studio 素材可按 hash 复用；来源 XML 的 Apache 头不等于全部位图可随应用重打包。
- 怎么用：记录真实输出、应用权限和错误三者；用实际 Tablet/Nexus layout 代替手写猜测；官方源只按需获取，保存来源与固定版本。导入占位图片只能验证字段/路径链路，不能当真实外观验收。能力刷新带自动默认时，另记显式手选（包括 null 通用外框），避免重置覆盖。

实施与截图见 [施工图](../../../plans/2026-10-07-skin-camera-integration.md)。用户已有 dev 实例保留；renderer 热更不能替代 main/preload 重启。


## 前景遮罩的后续约定

2026-10-07 用户允许真实边框遮住视频，覆盖当时“全部位图放视频下方”的决定。Pixel 7 mask.webp 为屏幕大小 1080×2400，中心 alpha 0，圆角和摄像头处 alpha 255；它可直接叠在 canvas 上方。背景仍在视频下方，前景按 display 的 quarter-turn 与方向回退旋转，输入继续使用同一屏幕矩形。只有图片中心透明才能保留可见内容，占位 PNG 不可当真实遮罩使用。
