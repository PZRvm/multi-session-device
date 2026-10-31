---
description: SDK 来源切换矩阵在 win32 整体失真——classifyRoot 三个 SDK 标记全是 darwin 路径，切出零迁移不弹评估、回切被 target-junk 拒绝；真机验收实证（2026-10-22 记录的 sdkMigration adb 探测假阴性实为三处全中）
created: 2026-10-31
tags: [windows, sdk, migration, source-switch, acceptance]
---

# SDK 来源切换矩阵 win32 全失真——classifyRoot 标记未平台化

## 现象（2026-10-31 Windows 真机验收实测，两条同根源）

1. **托管 → 自选空目录：零迁移**。切换"成功"（sdk.json 翻到 custom），但一个文件都没搬——自选根保持空目录，托管根 8.2G 原封不动；迁移评估弹窗（needs-migration 原生 dialog）从未出现。后果：活动根指向空目录，全部设备无法启动。
2. **自选 → 切回托管：被拒**。报「目标路径有无法识别的内容：请清空或另选路径」（target-junk）——托管根明明是完整可用的 SDK。

## 根因

`sdkMigration.ts` 的 `classifyRoot`（:285-289）用三个标记识别"这是个 SDK"：

- `platform-tools/adb`（win32 实为 `adb.exe`）
- `emulator/emulator`（win32 实为 `emulator.exe`）
- `cmdline-tools/latest/bin/sdkmanager`（win32 实为 `sdkmanager.bat`）

三处全是 darwin 路径，win32 上恒探测失败 → 任何非空根在 win32 都判 `junk`。该函数被两处复用，故障互相放大：

- **switchSource 矩阵**（sdkSourceSwitch.ts:170 附近）：目标非空即 `target-junk` 拒绝 → 症状 2；
- **appOwnedLosers**（:112）：候选根须 `classifyRoot === 'sdk'` 才算落选根 → win32 上托管根"隐形"、losers 恒空 → 矩阵落 direct 分支（当场翻 sdk.json，不弹迁移评估、不搬文件、不 relink AVD）→ 症状 1。

与 2026-10-22-windows-studio-detect-review 记录的「sdkMigration.ts:296 adb 探测 win 假阴性」同源——当时只点名 adb 一处，真机实证是 classifyRoot 三标记全中，影响面从"一条探测"放大为"win32 来源切换整体不可用"。同族先例：profiles.ts avdmanager 链、javaBinFor/javaHomeFor（见 learn 2026-10-30-windows-darwin-path-duplicates——又一个绕过 sdkPaths 单源自行拼路径的站点）。

## 影响与边界

- win32：来源切换矩阵（direct/needs-migration/needs-choice 三分支判定）全部失真；迁移本体（真跑起来的 move/复制链）在 win32 未被实测覆盖（矩阵从未走到）。验收第 7 项（来源切换/跨盘迁移）被本 issue 挡死。
- darwin：零影响（标记路径即 mac 真值，既有单测全绿）。

## 修法方向（下一批，验收期间不修）

`classifyRoot` 三标记改走 `sdkPaths(root, platform)` 单源（`adbBin`/`emulatorBin`/`sdkmanagerBin`，platform 接缝注入，先例：javaBinFor 修复 5de6436）；`appOwnedLosers`/switchSource 经 deps 透传 platform；补 win32 单测（win 布局根判 sdk、空根判 empty、杂物判 junk）。修复后真机补验：托 管→自选迁移全链（含 EXDEV 跨盘）、切回托管、AVD relink。

> **修复批（2026-10-31 同日，用户拍板验收期间即修）**：按上述方向落地——`MigrationDeps` 增可选 `platform` 接缝（缺省 `process.platform`），`classifyRoot` 三标记改取 `sdkPaths(root, deps.platform ?? process.platform)` 的 `adbBin`/`emulatorBin`/`sdkmanagerBin`（darwin 输出与原字面量逐字节一致，构造性零回归）；`appOwnedLosers`/switchSource/adoptSourceSwitch 均经 `deps.migration` 自动获得平台。补 win32 单测（platform 注入 + join 夹具，双宿主绿）。定向三文件（sdkMigration/sdkSourceSwitch/sdkSource）失败数与基线逐文件一致（15/30/4，均宿主旧账），typecheck/lint 0 错。真机补验待用户重启后进行：托管→自选迁移全链、切回托管。

## 遗留备注（本批不修，只记录）

- `defaultDeps.fsTypeOf`（sdkMigration.ts）用 mac 的 `diskutil` 解析卷文件系统——win32 上 spawn 失败恒回 null，FAT/exFAT 目标卷预检在 Windows 实际不拦（宽松降级，不误拦但也不防护）。后续如需 win 等效，走 `Get-Volume`/`fsutil` 另立批次。
- 验收期间已知抖动：external.test.ts 与部分 renderer 组件测试在全套并发跑时偶发超时（单独跑全绿，P4 施工期即有记录），与平台分支无关。

## 验收期 workaround（已执行，2026-10-31）

关闭应用后手改 `%APPDATA%\multi-session-device\sdk.json` 为 `{"version":1,"source":"managed","customPath":null,"sharedPath":null}` 重启即恢复托管根（磁盘内容从未被动过，无损）；自选空目录可删。**不要**按报错提示"清空目标路径"——托管根里有 8.2G 镜像。
