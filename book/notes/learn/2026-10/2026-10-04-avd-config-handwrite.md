---
description: AVD 目录结构可以手写——emulator 只读 .ini + config.ini，最小配置冷启动 9 秒，绕开 avdmanager 依赖
tags: [android, avd, emulator, avdmanager, config]
---

# AVD 目录结构手写——不依赖 avdmanager

- **Scenario**: 需要程序化创建 AVD，但 avdmanager 在目标环境不可靠（issue 2026-10-04-avdmanager-sdk-root-null；2026-10-05 更新：那个环境的根因是 cmdline-tools symlink，修复后 avdmanager 可用，本应用也已切回 `avdmanager create avd -d <画像>`——手写路线降级为备用知识，适合不想引 Java/网络依赖的场景），或者想省掉 Java 启动开销。
- **Why**: 一个 AVD 就是 `<AVD_HOME>/<name>.ini`（指向目录）加 `<name>.avd/config.ini`（硬件与镜像配置）两个文本文件；emulator 启动只读它们，不查任何数据库。指向已装镜像（`image.sysdir.1=system-images/android-36/google_apis/arm64-v8a/`）+ 画像硬件键（hw.lcd.*、hw.ramSize、hw.cpu.arch=arm64）即可启动。实测 Android 16 镜像冷启动 9 秒 boot 完成。
- **怎么用**: 以 Android Studio 建的 AVD 为参照抄 config.ini 键位（`~/.android/avd/<name>.avd/config.ini`）；`tag.id`/`image.sysdir.1` 必须与镜像目录一致；`hw.sdCard=no` 可省掉 sdcard.img。启动环境变量四件套：`ANDROID_AVD_HOME`、`ANDROID_USER_HOME`、`ANDROID_EMULATOR_HOME`、`ANDROID_SDK_ROOT` 全指应用自有目录即完成隔离。
