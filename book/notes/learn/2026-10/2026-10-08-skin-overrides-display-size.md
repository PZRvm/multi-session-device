---
description: 无头模拟器也会从皮肤读取屏幕尺寸；小图标先对比配置、实际尺寸和密度
tags: [emulator, skin, resolution, density, tiny-icons, geometry]
---

# 皮肤会改变无头模拟器的屏幕尺寸

- 场景：QVGA 选 Pixel 7 皮肤后，Android 能启动，但桌面图标极小、屏幕变成长条。
- 原因：`config.ini` 是 240×320、120 dpi，生成的 `hardware-qemu.ini` 却是 1080×2400、120 dpi。`-no-window` 只关闭原生窗口，皮肤的 display part 仍影响屏幕尺寸；scrcpy 传回的就是被改大的画面。
- 判断：先看 `adb shell wm size`、`wm density`，再对照两个 ini。不要只调工作台 CSS，也不要用提高密度来掩盖机型分辨率变化。
- 修复：本应用自己绘制外框，启动时可用 `-skin WIDTHxHEIGHT` 固定为配置中的原生尺寸，不写回 AVD。参数必须保留原 GPU、摄像头、网络和快照设置，启动时重读，并隔离 runId。当前 emulator 37.2.12.0 的隔离 AVD 与实际应用验证均通过；[新版官方文档](https://developer.android.com/studio/run/emulator-commandline)已把此参数列为 deprecated，升级须回归。
- 显示：皮肤不可用时保留透明度检查并使用通用外框，诊断进日志。用户要求画面顶部无提示文字。QVGA 只有 240×320，恢复图标比例后放大仍会模糊。

实现与验收见[修复计划](../../../plans/2026-10-08-skin-native-display.md)。

后续补查：原生分辨率恢复后，QVGA 仍因安卓挖孔 overlay 保留了 136 像素顶部 inset 而破版。另见[挖孔设置经验](2026-10-08-qvga-cutout-insets.md)，不能把图标大小正常当作内部排版已完整验收。
