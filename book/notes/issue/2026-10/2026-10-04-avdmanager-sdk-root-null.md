---
description: cmdline-tools 19/20 的 avdmanager 在本机无法解析 SDK 根——--sdk_root 被移除、env 不生效，create avd 报 "Valid system image paths are: null"
---

# avdmanager 无法解析 SDK 根（cmdline-tools 19/20）

- **Observed**: 2026-10-04 PoC 期间（macOS arm64，cmdline-tools 20.0，本机 SDK 与全新 SDK 目录同样复现，JDK 17/21/25 同样复现）。`avdmanager create avd -k <镜像>` 必然失败：`Error: Package path is not valid. Valid system image paths are: null`；`list target` 返回空；已有的 Studio 建的 AVD 也报「Missing system image」。同版 `sdkmanager` 必须显式 `--sdk_root=<dir>` 才能工作——`ANDROID_HOME`/`ANDROID_SDK_ROOT` 环境变量被无视。
- **Reproduction**: `ANDROID_HOME=<sdk> avdmanager create avd -n x -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_8`（stdin 喂 no）→ 报 null；对空目录 fake SDK 同样报 null。字节码显示 AvdManagerCli 从 `com.android.sdkmanager.toolsdir` 属性上溯两级推 SDK 根，路径推对了仍然 null。
- **Suggested direction**: 步骤 3（AVD 接真）的 createAvd 不走 avdmanager，按 AVD 目录规范直接写 `.ini` + `config.ini`（见 learn 2026-10-04-avd-config-handwrite，PoC 已实测可行）；画像/分辨率表从固定画像库或 manifest 取。若日后要回到 avdmanager：试旧版 cmdline-tools（≤16）或等 Google 修复；sdkmanager 装/查包不受影响（显式 `--sdk_root` 即可）。

严重级：P1（阻塞 avdmanager 路线，已有替代方案）。PoC 已按替代方案落地，步骤 3 设计需沿用。
