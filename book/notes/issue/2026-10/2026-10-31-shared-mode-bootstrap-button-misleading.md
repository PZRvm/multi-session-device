---
description: 共享模式缺 cmdline-tools 时向导仍出「完成 SDK 引导」按钮——点击必被共享只读守卫拒绝；应显示「去 SDK Manager 补装」指引（sdkSharedNotReady 文案已备而未接）
created: 2026-10-31
tags: [windows, shared-mode, wizard, ux, acceptance]
---

# 共享模式缺件时向导引导按钮误导

## 现象（2026-10-31 真机）

用户切共享 Studio SDK 后打开向导，画像清单报未就绪，错误块出现「完成 SDK 引导」按钮；点击后被 `assertSdkWritable` 的共享只读守卫拒绝（`sdkSharedReadOnly`）——按钮在共享模式下永远不可能成功。根因素材：共享根缺 `cmdline-tools`（Studio 默认不装，应用建设备必需 avdmanager/sdkmanager）；JBR 在场 Java 无碍。

## 根因

`DeviceWizard` 的引导探测（useEffect → `sdk:status` 快照）只判 `!cmdlineTools.present || !jre.present`，不看当前来源模式；而 `sdkBootstrap` handler 首行 `assertSdkWritable` 在共享态直接拒绝。共享模式缺件的正确指引已有现成词条 `sdkSharedNotReady`（「请在 Android Studio 的 SDK Manager 补装命令行工具…」），但向导错误块未按模式分流。

## 修法方向（记录不修）

`DeviceWizard` 已持有 `sdkSource`（镜像清单响应附带）——探测为可引导前加 `sdkSource !== 'shared-studio'` 条件；共享分支改渲染 `sdkSharedNotReady` 指引文案（无按钮）。补用例：共享态不出引导按钮、出指引文案。

## 修复批（2026-10-31 同日，用户拍板即修）

按修法方向落地：`DeviceWizard` 探测 effect 加 `sdkSource === 'shared-studio'` 早退（共享不置可引导标记）+ 渲染侧再闸一次模式（`sdkBootstrapable && sdkSource !== 'shared-studio'`——sdkSource 随镜像清单异步到达、可能晚于报错与探测置位，双闸防竞态）；指引无需新增——共享态的 `profiles.error` 本就是 `sdkSharedNotReady` 文案（含 SDK Manager 指引）。新增用例：共享态缺件不出引导按钮、指引文案在场（DeviceWizard 套件 45/45）。typecheck/lint 0 错；全套 153 失败与基线逐数一致、通过数 +1。

## 修复批二（2026-10-31 同日，用户拍板）：指引升级为分步图文

用户要求操作步骤以图文形式展示且风格对齐设计系统。落地：i18n 三语补 `sdkSharedGuideTitle` + `sdkSharedGuideStep1-5`（五步：开 Settings → SDK Tools 页 → 勾 cmdline-tools → Apply → 回应用重试）；`DeviceWizard` 共享态错误块渲染 `SharedSdkGuide`（styled-components 浅底卡：board 令牌配色随深浅主题自适应、4px 圆角与既有一致、步序圆号 + lucide 图标（Settings/ListChecks/SquareCheck/Download/RotateCcw，14px accent 色）+ 文案）。三元首支即模式闸（TS 窄化证明二闸冗余，从简）。用例扩为标题+五步全量断言（45/45）。typecheck/lint 0 错；全套 153 与基线一致。

## 真机处置

引导用户在 Android Studio SDK Manager 补装「Android SDK Command-line Tools (latest)」后共享态就绪，画像列表恢复——不依赖本修复。
