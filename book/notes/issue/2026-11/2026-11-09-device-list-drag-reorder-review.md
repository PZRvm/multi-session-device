---
description: 拖拽换序批 code review（Phase 5）——1 项 P2（陈旧拖拽态下外来源拖放可被接受且无效 drop 不拦 Electron 默认导航）+ 4 项 P3；P2/P3-B 随修复批处理
status: open
---

# 拖拽换序批 code review 记录（2026-11-09，合并前 Phase 5）

审阅对象：feature/device-list-drag-reorder 分支 a6b0f75（22 文件，+1294），对照 plan [2026-11-09-device-list-drag-reorder](../../../plans/2026-11-09-device-list-drag-reorder.md) 与 multi-session-browser 先例。结论：**总体 pass、无 P1**；1 项 P2 + 4 项 P3。

## Findings

### P2-A（已修复——修复批 78ef1ce，2026-11-09）

**陈旧拖拽态下外来源拖放可被接受，且无效 drop 分支不拦 Electron 默认导航。** `useListDragReorder` 的 dragover 只以本地 dragId 判"本列表发起"：拖拽中源行被删（如删除在途完成）时 dragend 不达容器，dragId/hint 滞留；此后外来源拖放（典型：从 Finder 拖 APK 文件入列表）会被 dragover 误接受（preventDefault + 显示插入线），drop 落进无效分支直接 return（不 preventDefault）——Electron 对未拦的 drop 默认导航到文件，窗口白屏。低频（需删删竞窗 + 用户随后拖文件过列表）高损。

**处理**：修复批三件——① dragover 加 MIME 根闸（`dataTransfer.types.includes(mime)`，外来源一律系统「不可投放」；AVD 与真机两列表 MIME 不同，跨列表互不干扰）；② drop 入口无条件 preventDefault（无效分支同样拦默认导航）；③ dragover 自愈：dragId 不在 ids 时 finish() 清瞬态。测试：外来源即使瞬态滞留也不被接受 / 自愈后无 hint 无 IPC / 无效 drop 被拦。全量回归绿。

### P3-B（已修复——修复批 78ef1ce 消除危害路径，修复批 2 消除视觉滞留）

P2-A 的诱因根：拖拽中源行被删 → dragend 不达容器 → hook 瞬态滞留，直到同列表下一次 dragstart 复位；期间插入线可能视觉滞留。修复批的自愈逻辑消除了危害路径（外来源不可再被接受），但「无后续交互时插入线视觉滞留」仍可能（下一次同列表拖拽即复位）。修复批 2（c4590b0）补全：rowVisual 读取时对 ids 对账——瞬态指向已消失行即不渲染，插入线/半透明不再滞留到下一次拖拽（effect 方案被 react-hooks/set-state-in-effect 拦下，读取时守卫零级联渲染）。

### P3-C（已修复——修复批 2 c4590b0）

`deviceStore.reorder` 失败且重拉也失败：`loadError` 只在列表为空时显示（DeviceListPane 空库提示分支），非空列表下乐观序滞留至下一次 `devices:changed` 推送修正。最终一致但过程无提示。

**处理**：DeviceListPane 非空列表上方加读取失败横条（`loadError !== null && devices.length > 0`，复用 loadFailed/retryLoad 文案零新词条）——reorder 失败且重拉也失败时用户看到原因与重试入口；重拉成功的场景列表已自行归位（拖拽弹回本身即反馈），不打扰。设计取舍：按「过程无提示」的根因（重拉也失败）定向提示，而非对每次失败弹 toast。

### P3-D（已修复——修复批 2 c4590b0）

删除在途（deleting 行仍在 acceptedMetas）时发起拖拽重排：可拖宇宙按 plan 口径排除 deleting 行，ids 长度 ≠ metas 长度 → 主进程整单拒绝 → renderer 重拉 → 行弹回原位，无错误提示。低频竞窗。

**处理**：deleting 行仍在 acceptedMetas——纳入重排宇宙（ids 只排除 creating），拖拽期间删除完成也能整单校验通过不再弹回；行级仍不可拖不可锚（即将离场）。删除在 dragstart 与 drop 之间真正提交（meta 已移除）时，陈旧 ids 走既有整单拒绝 → 重拉收敛路径。

### P3-E（open，定档备忘不回填——唯一留置项）

档位边界：本批新增 2 条 IPC 通道，触及项目 always-L 域「shared IPC contracts」。hibernation 批（3 条通道）同形先例按 M 跑，仓库实践把"功能域内新增通道"按 M 档处理；若严格按 task-tiers 升 L，缺的门只有 ADR 触发检查——三项触发（难逆/合理人可另判/架构边界）均不成立。记录不回填；后续新增通道批可在一句话 motive 里显式核对该域。

## 已核对无虞的检查项

- 权限/授权：两通道分别 requireSender('main') / requireMain，对齐各自域先例；服务端整单校验 + assertMetaWritable 双闸在位
- 竞态：external reorder handler 读校验写全程同步无 await（与 track 帧天然串行）；commitMetas 临界区内校验，单次失败不断队列
- 事务边界：AVD 重排是纯数组重排不改字段，CAS 天然保护数组序；真机 commitOrder 内存先行、失败告警不回滚（会话内不丢序）
- 通知边界：AVD 走 broadcastChanged、真机走既有广播，无漏通知；会话桥零事件（顺序与 runId 无关）设计正确
- 边界值：空库/单行/全未知序/上限 64/损坏文件/版本不符均有测试
- 体验接缝：插入线/半透明/禁选字三件与既有视觉语言一致（灰阶、零动画）；零新 UI 文案
