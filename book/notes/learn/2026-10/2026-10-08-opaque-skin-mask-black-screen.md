---
description: 启动完成却显示整块灰色时先对比设备截图与投屏；完全不透明的皮肤前景必须回退，不能误修 AVD
tags: [emulator, skin, black-screen, alpha, debugging]
---

# 黑屏先区分安卓、投屏与皮肤

- 场景：两台已有模拟器启动后，应用显示相同灰色整框，用户怀疑配置编辑改坏设备。
- 证据：两台 sys.boot_completed=1、bootanim stopped、屏幕 Awake；ADB screencap 有正常安卓画面。应用无连接错误，不能据“黑屏”认定系统启动失败。
- 根因：两台共用 imported 皮肤的 mask.webp 与 back.webp 文件哈希相同，都是完全不透明的灰图。前景在 canvas 上方，把正常视频全盖住。现有资料曾记该皮肤是占位测试素材；无法确定写入者。
- 修法：皮肤图片预加载时，仅对 foregroundMask 用最多 64×64 离屏 canvas 检查 alpha；完全不透明或检查失败时，走已有皮肤失败回退并说明原因。普通不透明背景合法；真实透明遮罩仍可遮住圆角和挖孔。采样用于拦截全不透明图片，不是任意遮挡比例或皮肤质量判定。
- 验证：透明、全不透明、普通背景、检查失败四条组件回归；真实应用两台画面恢复，Pixel 8 主页输入后设备焦点变为 Launcher。修复前后 config.ini、devices.json、皮肤三文件的 6 项哈希一致；没有重建、清数据或改容量。

开发窗口没有及时载入热更时，先确认当前页面版本。此次从 View → Force Reload 后恢复最新页面；无需为 renderer 修复重启安卓或共享 ADB。完整证据和局限见 [修复计划](../../../plans/2026-10-08-opaque-skin-black-screen.md)，配置编辑另见 [审查报告](../../issue/2026-10/2026-10-08-device-config-edit-audit.md)。
