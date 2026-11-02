---
description: feat/windows-branch 并入 dev 的合并集成 review——0 P1 / 1 P2（dialog avdHome 白名单 win32 失效，孤立报告「打开目录」必被拒）/ 4 P3；接缝文件双侧内容完整、护栏口径一致、npmrc×下载链证伪交互
created: 2026-10-31
tags: [windows, review, merge, integration, dev]
---

# Windows 支线并入 dev 合并集成 review（2026-10-31）

范围：`2a0a7df`（Merge feat/windows-branch into dev；dev 侧带入 0d835c2 关于页真值 + 3765f6f npm 镜像，支线带入 59 提交）+ `ea4ddd6`（索引生成器 CRLF 健壮化与重生成）。评审焦点＝合并缝：双侧交集文件（SettingsParts.tsx / ipc-channels.ts / types.ts / README）与语义交互。合并后 dev 门禁：typecheck/lint 0 错、全套 153 失败与基线逐数一致（夹具旧账非合并引入）、1269 过。

**结论：合并干净、无需重并或回滚；1 条 P2 行为缺陷应在 Windows 发版前修。**

## 核对过的接缝安全点（评审实证）

- 三个自动合并源码文件双侧新增内容**全部在场**：about 通道 × 深链通道、AboutInfo × avdHome 字段、.directory-line × .defender-card——通道字符串无重复，注册链各走各的聚合器。
- sender 护栏口径一致：about 通道的 `settingsOwns` 与 SDK 域同源（merge-base 既有）；win32 深链通道不设 sender 校验属既有先例（固定 URI、平台门控）。
- **`.npmrc` 镜像 × SDK 钉版下载链证伪无交互**：下载走 Electron netFetch 直连 GitHub/dl.google.com，npm/electron 镜像只作用于安装期。
- 索引在 HEAD 完整：329 篇 tracked .md 全部在册（328 条目 + README 自身不索引）。

## P2（应修——Windows 发版前）

1. **`src/main/dialog/index.ts:68` avdHome 白名单 win32 失效**：`resolved.startsWith(base + '/')` 在 win32 反斜杠路径下恒 false（仅 exact match 可过）→ 孤立报告文件的「打开所在目录」按钮（ReportApp → shellShowItemInFolder）在 Windows 上**必弹 shellPathRejected**。属 merge-base 既有 darwin 期守卫、双方未触碰，但正是本次合并启用的平台——learn 2026-10-30 警告过的"第四站点"形态且此前无任何 issue 记录。附带：按钮文案写死「在 Finder 中显示」（mainWindow.ts:158），win 下文案错。修法：`resolved === base || resolved.startsWith(base + sep)`（或复用 windowsPath 归一）；文案按平台出。

## P3（可顺延，记录在案）

2. `2a0a7df` 的 README 冲突解法曾短暂丢 dev 侧 3 条索引（--theirs 未含 10-23 关于页三篇）——2 分钟后 `ea4ddd6` 重生成即恢复，HEAD 已核完整。**过程教训：索引冲突解必须以重生成收尾，不能只取一侧**。
3. avdHome 单源旁路两处：`sdkSource.ts:152`、`dialog/index.ts:52` 自行 join `userData/avd-home`（avdHomePath() 零依赖叶子可引）；dialog 处的"拉不动依赖链"注释已过时。
4. `SettingsWindow.test.tsx:119` 快照夹具未标类型——branch 新增的 `avdHome` 必填字段静默漏过（win32-gated 不渲染故无害）；补 `: SdkSourceSnapshot` 注解让类型把门。
5. `dialog/index.ts:63-65` DLG_DBG 调试残留（merge-base 既有）。

## 处置

只记录未修（纪律）。P2-1 建议单独小修批（一处分隔符 + 一处文案 + 单测）；P3-3/4 可并小清理批；P3-2 为过程教训已入档。
