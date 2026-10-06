---
description: 手办画像（pixel_8）的 AVD 在系统层拒绝一切旋转：settings user_rotation、emu rotate、虚拟加速度计、相机应用均不改画面方向；手机横屏的真机视觉验证待强制横屏应用或日常人工使用覆盖
tags: [emulator, android, rotation, acceptance]
---

# 手机画像 AVD 系统级拒绝旋转，横屏视觉验证受阻

- **问题**: avdmanager 建的 pixel_8 AVD（API 32 aosp，arm64）上画面方向无法改变——`settings put system user_rotation {0..3}`（配 user_rotation_mode 1）、`adb emu rotate`、`adb emu sensor set acceleration 9.8:0:0`（配 accelerometer_rotation 1）、启动 `com.android.camera2`（应强制横屏）四条路全部不动 format（各等 25-30s）。同一台 WXGA **平板** AVD 对 user_rotation 正常响应，故非脚本问题；怀疑 AOSP 手机形态的桌面/SystemUI 锁竖屏 + 该 image 相机也 portrait。
- **复现**: 起 pixel_8 AVD → 投屏 ready → 依次执行上述四类命令 → `__msdCanvas.format` 恒 1080×2400。
- **建议方向**: 手机横屏的真机验收改用一个明确 `screenOrientation="landscape"` 的最小测试应用（或系统内任一横屏游戏/视频）触发；几何本身已有单测两向覆盖（非对称上边框居中），平板真机两向旋转已过。外框分支将此项记为遗留：日常人工使用中旋转手机时补一眼截图即可。
