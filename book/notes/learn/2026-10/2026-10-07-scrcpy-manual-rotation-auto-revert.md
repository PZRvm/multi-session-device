---
description: scrcpy 手动旋转会恢复自动旋转；模拟器须先同步锁定方向，避免传感器立即转回竖屏
tags: [scrcpy, emulator, android, rotation, auto-revert]
---

# 手动旋转前先锁定自动旋转

- 场景：Pixel 10 Pro API 34 的 Android 设置页，工具条旋转一次后又恢复竖屏；renderer 没有发送第二次 rotate。
- 原因：scrcpy 3.3.3 的 [Device.rotateDevice](https://github.com/Genymobile/scrcpy/blob/v3.3.3/server/src/main/java/com/genymobile/scrcpy/device/Device.java#L169-L187) 先 freezeRotation，再按原状态 thawRotation。自动旋转开启时，模拟器竖屏传感器覆盖手动方向。初始实测 accelerometer_rotation=1、wm user-rotation=free，点击后仍为 rotation=0；先 lock 后，同一按钮得到 lock 1、rotation=1，并保持横屏。
- 做法：在释放触点后，以绑定会话的 serial 执行 adb shell wm user-rotation lock，成功后再发 scrcpy rotateDevice。这个命令直接同步冻结当前方向，比写 settings 后依赖异步观察器更适合控制消息前的顺序保证。锁定失败拒绝操作，等待期间切设备、停机或换代次也拒绝后续旧输入。
- 语义：手动旋转关闭该设备自动旋转，后续点击仍切换横竖屏；Android 设置可重新开启。画面以实际视频尺寸为准。主页或应用自行限定朝向仍须另测，不能把这次设置页结果外推成所有应用都能横屏。

涉及 src/main/scrcpy/control.ts、index.ts；测试同级 **tests**/。方案与验收见 [plan](../../../plans/2026-10-07-manual-screen-rotation.md)。
