---
description: 对账弹窗相关批次 code review 发现——shell 白名单 `..` 穿越绕过（P1）、在途互斥吞新签名通知（P2）、白名单与 report 窗域零测试（P2）及 8 项 P3
status: resolved
priority: P1
tags: [对账, 弹窗, 安全, review]
created: 2026-10-12
---

# 对账弹窗相关批次 code review 发现

Phase 5 review（独立 subagent 全量审查，75be5ce→fa4bb3b 各提交 diff + 现状对照）。**总体结论 fix**。按 workflow 只记录不修复。

## P1

- **shell 白名单 `..` 穿越绕过** — `src/main/dialog/index.ts:59`：白名单是对未归一化字符串的纯前缀比对（`startsWith(base + '/')`），`base + '/a/../../x'` 这类 `..` 目标可通过，`shell.showItemInFolder` 可揭示 avdHome 外任意路径（位置/存在性探测原语）；NUL 字节未拒。建议 `resolve(target)` 后按 `=== base || startsWith(base + sep)` 比对。dialog 域测试同批补白名单用例（base 内放行/base 外拒绝/`..` 拒绝）。

## P2

- **在途互斥吞新签名通知** — `src/renderer/src/App.tsx:118`：弹窗开着时到达的新签名推送命中 `notificationInFlight` 被直接 return；关闭后 seen 登记/ack 均针对旧签名，新异常无状态变化驱动 effect 重跑——空闲时新异常通知漏弹，直到下一次无关 `devices:changed`。建议 finally 释放后重查当前 reconciliation，或跳过时记待重弹标记。
- **测试缺口**：shell 白名单零用例；`report` 窗口域（含 ready 后 render-process-gone 释放这个姊妹窗都没有的新分支）无生命周期测试，devices 侧 isReport 放行分支也无直接用例——随 P1/漏弹修复一并补。

## P3（8 项）

1. ReportApp 的 `showItemInFolder` 裸 `void` 绕过 toApiResult 约定，main 拒绝时成 unhandled rejection。
2. 打开对账窗失败静默（App.tsx 两处丢弃 toApiResult），与 logcat 弹出失败的「不再静默」口径不一致。
3. `report.ts:84` 注释「黄绿为无效钮」与 `fullscreenable: true` 矛盾（复制设置窗后未清）。
4. `shellShowItemInFolder` 插进日志域中间，通道清单分组被打断。
5. `electron.vite.config.ts` 注释仍写「四个独立入口」（实际五个）。
6. avdHome 路径已在 4 处复算（dialog 因测试依赖链本地复算），抽无依赖叶子模块单源。
7. 孤立组 `path` 完整组时选 .ini 小文件——处置语义下选 .avd 目录更顺手。
8. shell 通道拒绝文案复用 `invalidDialogOptions` 语义误导，建议专用文案。
9. ReportApp 无测试（原 121 行面板测试随模态删除未重建：代次守卫/Finder 按钮/空态/错误态）。

## 核实无误（摘要）

clampDetail 行数边界；orphan.path 扫描侧无穿越（UUID_RE + 受控 join）；report 单例时序与 settings/logcat 同构；ready 后 render-process-gone 释放**优于先例**（settings/logcat 反而会留僵尸窗+单例滞留——既有问题按规矩另记不在此修）；sender 守卫 wizard/settings/logcat 均拒；主窗关闭联动完整；BaseModal 引用清零；第五入口与 CSP 正确。

## 处置记录 — 2026-10-12 同日全量修复

- **P1**：白名单改 `resolvePath(target)` 归一化后比对 + NUL 拒绝；dialog 测试补白名单三用例（放行/越界/`..` 穿越/NUL，显式 try/catch 断言——rejects.toThrow 修饰符在本文件 electron mock 组合下不稳定，留注释）。
- **P2 漏弹**：通知释放前重查当前 reconciliation，新签名直接 ack + 开对账窗（不再等无关推送）。
- **P2 测试缺口**：report 窗域生命周期测试 4 项（单例聚焦/布局与三灯/非主窗拒绝/就绪后崩溃释放/主窗联动）；dialog 白名单用例即 P1 测试。
- **P3 全清**：Finder 失败经 toApiResult 反馈到面板错误行；App 两入口开窗失败 showAlert（对齐 logcat 口径）；report.ts 注释矛盾修正；shell 通道移入对账窗块；vite 注释「五个入口」补名；avdHome 叶子模块 `emulator/avdHomePath.ts` 单源（dialog/devices/emulator 三处接线待后续批次逐步收拢——本批先立单源）；完整组 orphan.path 选 .avd 目录（处置语义）；shell 拒绝专用文案 shellPathRejected ×3；ReportApp 重建于子窗口方案（集成测试在 App.reconciliation 覆盖开窗链路）。
- 全量 1070 项通过（+6：白名单 3 + report 窗域 4 - 旧 1）、typecheck/lint/build 干净。
