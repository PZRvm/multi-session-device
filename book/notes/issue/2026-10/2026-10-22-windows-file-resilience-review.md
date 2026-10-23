---
description: P4 分支（fsWin/sha1 流式化 + SDK 切换弹窗化 + 同路径守卫修复）代码评审发现——无 P1；流程 P2 一条（lint 门禁口径）+ P3 两条；只记录不修
---

# Windows 文件链路健壮性（P4）及 SDK 切换弹窗化 — 代码评审发现

- **评审范围**：feature/windows-file-resilience 三个提交（e56c90d P4 功能 / 4e95de5 迁移评估改原生弹窗 / 59b89e0 同路径守卫修复），基 feat/windows-branch 66ebb1c；src 侧全量 diff（9 文件 +364/−250）。门禁状态：1372 测试全过、typecheck 0 错、lint 零警告（严格口径）。
- **纪律**：只记录，不顺手修——修复是下一轮独立工作。

## P2（应修，流程级）

- **P2-1 lint 门禁以退出码判定，警告可静默入库**：`npm run lint`（`eslint --cache .`）有警告时退出码仍为 0——e56c90d 因此带着 5 个 prettier 警告通过门禁入库，直到 59b89e0 才顺带修复。本评审起已改用「输出零警告」口径人工核验，但脚本层面仍会漏。建议：`package.json` 的 `lint` script 追加 `--max-warnings=0`（一行改动，归属下个修复轮或 chores 批）。

## P3（可顺延，记录在案）

- **P3-1 确认弹窗挂起期间单选钮未锁**：`locked` 不含「弹窗等待中」——needs-migration/needs-choice 弹窗未决时，用户仍可点其他来源单选钮触发第二次 `evaluate`（旧卡片时代同样未锁，非弹窗化新引入；main 侧判定矩阵对「迁移进行中/动作在途」会拒绝，后果有界）。建议下轮给 `locked` 加弹窗 pending 态。
- **P3-2 choice 的「迁移替换」分支丢失一行关键语义**：合并为单弹窗后，替换方案只剩 `choiceReplaceDetail` 一句（"删除目标路径的 SDK，把当前 SDK 移动过去"），原 replaceConfirm 弹窗里 `migrateConfirmDetail`（"迁移为移动：完成后源路径清空，镜像引用自动改写"）不再出现——被替换侧（当前 SDK）"源路径清空"的后果说明缺位。建议下轮把该句并入 detail 的 ① 行。
- **P3-3 弹窗 payload 断言仅覆盖 zh-CN**：PaneEmulator 测试一贯只挂 zh-CN 字典，zh-TW/en 靠 SettingsCopy 类型与 i18n 域测试保证——历史一致口径，不算缺口，仅记录。

## 核过无问题的点

posix 直通是构造性保证（fsWin 非 win32 分支即 `fs.rename` 本身，四个替换点 darwin 下逐字节等价）；EXDEV 回退的各调用点目标路径均先经 removePath/不存在（`cp force` 覆盖语义无实际生效面）；`createHasher` 默认实现有 sha1 已知值直证用例、取消检查点时序与原 sha1 检查点等位；守卫修复语义正确（无操作分支仅剩「更换路径…」入口可达，单选钮入口被 `currentMode` 守卫先拦）；7 个死文案键 ×3 字典清理由 SettingsCopy 类型系统保证无残留引用；迁移进度/崩溃恢复/保留根卡片不受弹窗化影响。

已在 plan 实现记录挂账、不重复列级：流式哈希反映流字节而非盘上字节（P4 自查记录）；全量测试一次 1 例偶发失败未复现（如再现立 issue）。

## 结论

无 P1（阻断级）问题。三个提交可合并；P2-1 建议随下个修复轮落一行脚本改动，P3-1/P3-2 可同批或顺延。

## 修复记录（2026-10-22 修复轮）

- **P2-1 已修**：`lint` script 追加 `--max-warnings 0`——警告直接挡门禁；正反双向验证（现状零警告通过 + 注入格式违规文件确认非零退出），1372 测试全过。
- **P3-1 / P3-2 未修**（按纪律顺延，可并入后续修复轮或统一集成批）。
