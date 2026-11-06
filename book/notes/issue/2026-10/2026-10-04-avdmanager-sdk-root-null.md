---
status: resolved
description: avdmanager create avd 报 "Valid system image paths are: null"——根因是 SDK 的 cmdline-tools 符号链接把根推断带到了 Homebrew 空壳目录（2026-10-05 已修复并更正根因）
---

# avdmanager 无法解析 SDK 根（根因：cmdline-tools 符号链接）

- **现象**：2026-10-04 PoC 期间起，`avdmanager create avd -k <镜像>` 必然失败：`Error: Package path is not valid. Valid system image paths are: null`；`list target` 恒为空；已有 AVD 报「Missing system image」。19.0 / 20.0 / 23.0 三个版本、JDK 17/21/25、全新空 SDK 全部复现，而 `sdkmanager --sdk_root=<dir>` 一切正常。
- **真根因（2026-10-05 定位）**：本机 `~/Library/Android/sdk/cmdline-tools` 是一个**符号链接**，指向 `/opt/homebrew/share/android-commandlinetools/cmdline-tools`（Homebrew 安装）。avdmanager 的 SDK 根推断逻辑是：取 launcher 传入的 toolsdir → `File.getCanonicalFile()`（解析 symlink）→ **上溯两级**当 SDK 根。穿过后 canonical 落在 brew 树内，上溯得到 `/opt/homebrew/share/android-commandlinetools`——那里只有 cmdline-tools 本体，没有任何镜像/平台，于是「合法镜像路径 = null」。sdkmanager 不受影响（接受显式 `--sdk_root`）。PoC 期间「19/20 都坏、换 23 也坏、空 SDK 也坏」的所有测试全部穿过这条 symlink，环境变量与 Java 版本都是烟雾弹。附带发现：Homebrew 直装的 avdmanager（`/opt/homebrew/bin/avdmanager`）因 launcher 自解析 `$0` symlink + 同一 canonical 启发式，**永远**把 brew 前缀当 SDK 根——除非真往 `/opt/homebrew/share/android-commandlinetools` 里装镜像。
- **修复（2026-10-05，已验证）**：① 删除 `~/Library/Android/sdk/cmdline-tools` symlink；② cmdline-tools 23.0 实体目录搬进 `~/Library/Android/sdk/cmdline-tools/latest`（sdkmanager 正规安装，build 16111833）；③ brew 树 `latest` 以符号链接回指 SDK 实体，让 PATH 上的 `/opt/homebrew/bin/avdmanager` 也走对根。验证：`list device` 96 画像、`list target` 3 平台、`list avd` 认出既有 AVD、`create avd`（android-36 google_apis 真镜像）成功、`emulator -list-avds` 认出、`delete avd` 成功；Java 8 默认已切 `jenv global 17`（同日）。
- **对应用的影响**：应用内新建设备不依赖 avdmanager（内置画像目录 + 手写 AVD config，PoC/步骤 3 已验证），维持现状；avdmanager 修好属于本机工具链恢复。若日后想让应用改走 avdmanager 需重新过设计。

严重级：已解决（记录留档——排查过程里「换版本、换 JDK、换 SDK 都复现」的三重烟雾弹值得记住：先查路径上的 symlink，再怀疑工具本身）。
