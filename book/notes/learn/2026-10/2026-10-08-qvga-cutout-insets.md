---
description: 分辨率恢复后仍破版，要检查安卓残留的挖孔屏 overlay 与实际窗口 inset
tags: [emulator, skin, cutout, overlay, insets, qvga, layout]
---

# 小屏顶部大片空白，要检查挖孔屏模拟

- 场景：QVGA 恢复为 240×320 / 120 dpi，仍有顶部大片空白、搜索框遮住应用列表。ADB 原始截图同样异常，说明问题在 Android 内部。
- 原因：`com.android.internal.display.cutout.emulation.hole` 处于 `STATE_ENABLED`。`dumpsys window displays` 显示顶部 cutout 和状态栏高 136 像素，屏幕总高只有 320 像素；修正分辨率并没有清理这个独立的安卓设置。
- 修复：先核对 `emu avd name` 与当前用户，只在这台本无挖孔的 QVGA 上执行 `cmd overlay disable --user 0 com.android.internal.display.cutout.emulation.hole`。需要回退时执行对应 `enable`；不能全设备批量关闭，也不能清 Launcher 数据。
- 验证：本例关闭后即时检查仍有旧 inset，正常停/开后 overlay 保持禁用，cutout inset 为 0，状态栏高 18 像素；240×320 / 120 dpi 保持原值。用户确认应用列表恢复正常。
- 教训：图标比例正常、系统启动完成都不能替代布局验收。遇到破版，要核对原始截图、尺寸、密度、cutout/insets，再看桌面和应用列表。源码未改时不重复跑前端构建，把验证放在实际设备与重启保留上。

机制见 [AOSP Display cutouts](https://source.android.com/docs/core/display/display-cutouts)，操作范围与结果见[修复计划](../../../plans/2026-10-08-qvga-cutout-repair.md)。
