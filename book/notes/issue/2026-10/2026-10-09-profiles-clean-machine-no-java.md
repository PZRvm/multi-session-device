---
description: profiles.ts 以宿主环境启动 avdmanager 未注入自带 JRE；从未装过 Java 的干净 Mac 上向导画像枚举失败，新建设备被挡在第一步，违背 PRD E 零依赖
status: resolved
priority: P2
tags: [wizard, profiles, jre, bootstrap]
---

# 画像枚举未注入自带 JRE，干净机器上新建设备被挡在第一步

- **观察**：2026-10-09 会话问答中实测发现。[profiles.ts](../../../../src/main/emulator/profiles.ts) 的 defaultRunner 用 `{ ...process.env }` spawn `avdmanager list device`，未注入 JAVA_HOME。avdmanager 包装脚本（cmdline-tools 23.0）的解析顺序是 JAVA_HOME → PATH 上的 java，都没有即退出；本机以 `PATH=/bin` 实测，错误原文 `ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.`。
- **复现**：在从未安装过任何 JDK 的 macOS 上（Electron 从 Finder 启动，PATH 仅 /usr/bin:/bin 等系统目录）：打开新建设备向导 → 画像列表加载失败——`/usr/bin/java` 是 stub，机器无 JVM 时自身失败。`sdk:profiles` 与 `sdk:wizard-capabilities` 共用 profilesCached（[emulator/index.ts](../../../../src/main/emulator/index.ts)），两条通道同时失败。开发机装有 4 个 JDK（`/usr/libexec/java_home -V` 实测），stub 解析到 Temurin 25，掩盖了缺口。
- **影响**：干净机器上「创建新设备」整个入口被挡在向导第一步，违背 PRD E「零 Android Studio 依赖」的自带 JRE 设计。不受影响的环节：已建设备运行/投屏/停止（emulator 为原生二进制）、镜像下载（downloader 绕过 sdkmanager 直连）、bootstrap（sdkManagerEnv 已注入 JAVA_HOME）、AVD 创建（[avd.ts](../../../../src/main/emulator/avd.ts) 已注入）、镜像卸载（sdkManagerEnv）。
- **建议方向**：profiles.ts 的 spawn 环境注入 `JAVA_HOME = <sdkRoot>/jre/Contents/Home`（与 avd.ts 同款），单测断言注入。也可并入「SDK 来源」调研报告（[think-report 20261009022552](../../think-report/20261009022552-SDK共享检测与真机投屏.md)）2.5 第 2 步的运行环境解析模块统一处理，并把「干净机器画像枚举」列入该模块验收项。按 workflow 只记录，本轮不修。

## 2026-10-09 修复

默认执行器显式使用当前 SDK 的自带 JRE，并隔离 Android 用户目录；缓存枚举、创建重核验和编辑能力查询三处都传入 SDK 根。JRE 缺失或无法执行时返回修复提示，不再依赖宿主 Java。

新增 7 项回归先失败后通过；相关 123 项通过。真实隔离环境中，PATH 不含 Java、JAVA_HOME 未设置或指向错误目录时，均读取 96 个画像并正确生成 Pixel 8 能力。使用 Temurin 21.0.12.1、cmdline-tools 23，SDK 路径含空格。见 [五项修复计划](../../../plans/2026-10-09-remaining-issue-fixes.md)。
