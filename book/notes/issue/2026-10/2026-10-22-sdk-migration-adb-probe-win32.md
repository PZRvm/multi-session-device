---
description: sdkMigration 的 SDK 根核验探测写死无后缀 adb 路径——win32 下恒假阴性，迁移/切换根验证会误判
created: 2026-10-22
status: open
tags: [windows, sdk-migration, adb, detection]
---

# sdkMigration 的 adb 探测在 Windows 恒假阴性

P2（Windows 检测链）施工评审发现，**只记录不修**。

## 问题

`src/main/emulator/sdkMigration.ts:296-298` 的 SDK 根核验探测写死无后缀路径：

```ts
(await deps.pathExists(join(root, 'platform-tools', 'adb'))) ||
(await deps.pathExists(join(root, 'emulator', 'emulator'))) ||
(await deps.pathExists(join(root, 'cmdline-tools', 'latest', 'bin', 'sdkmanager')))
```

Windows 上实际文件是 `adb.exe` / `emulator.exe` / `sdkmanager.bat`——三条探测全落空，`looksLikeSdkRoot` 语义在此模块恒为 false。

## 影响

SDK 来源切换/迁移（sdk-source-switching 域）在 Windows 上对真实 SDK 根会误判为「不像 SDK 根」，阻断或误导迁移流程。mac 不受影响（现行全绿即证）。

## 复现

注入 `platform: 'win32'` 形态的 deps（`pathExists` 命中 `platform-tools/adb.exe`）调用该探测函数——现行实现返回 false。

## 建议方向

复用 P2 已落的平台化口径：`studioDetect.ts` 的 `looksLikeSdkRoot` 已收 `isWin` 参数（`platform-tools/adb.exe`），可导出共用或对齐其写法；三处探测点（adb/emulator/sdkmanager）各补后缀分支。归 P1 引导平台化之后的批次修（P4 或独立小改），不与 P2 合并。
