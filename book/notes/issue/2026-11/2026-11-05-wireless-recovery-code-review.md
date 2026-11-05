---
description: 无线修复复审的三项 P2 已按用户授权修复，截图门、日志失败壳与并发诊断均有失败回归转绿记录
---

# 无线诊断与修复 code review（2026-11-05）

范围：当前 worktree 相对 HEAD 的全部已跟踪改动与新文件，覆盖共享服务重启、任务保护、恢复会话、IPC/preload、UI 及测试。USB 通用修复扩展按用户要求暂缓，本次不把它算作现有功能缺陷。

结论：发现 3 项 P2，建议修复后再合并；本轮只记录，未修改实现和持久测试文件。初次验证记录中的“未发现新增 P1/P2”是当时检查结果，当前复审结论以本条为准。

## P2-1：截图路径绕过修复执行门和在途计数

- **位置**：`src/main/screenshot/index.ts:27–33`；恢复的等待与重启在 `src/main/devices/wirelessRecovery.ts:217–229`。
- **观察**：新门只接入普通 runAdb、scrcpy 等路径，截图仍经独立 runAdbBinary 直接 spawn，既不检查恢复门，也不登记 pending。截图 IPC 的 runningDevice 校验不检查恢复状态。
- **触发条件**：运行中的 AVD 或尚保留在线缓存的真机，在修复期间发起截图；或修复前启动的截图仍在途。
- **影响**：修复认为 pending 已清空时，仍可能有截图 ADB 客户端访问/重新拉起共享服务，与 kill/start 竞争；该截图也会被重启打断。不能保证“本应用在重启窗口内没有旁路重生”。
- **隔离复现**：加载当前 TypeScript 模块，替换 child_process.spawn 为计数替身；gate.reserve → gate.lock → runAdbBinary。输出 `gateActive=true, newAdbProcesses=1, pendingTracked=0`，证明门关闭时仍启动 ADB 且未计数。没有操作真实服务。
- **建议方向**：截图二进制执行器接入同一命令门和进程收尾计数；新增“锁内拒绝新截图”和“已有截图在途时不开始 kill”的回归测试。仅记录，不修复。

## P2-2：修复期间订阅日志会留下无法恢复的失败会话

- **位置**：`src/main/logcat/index.ts:195–209`、`234–239`、`273–281`。
- **观察**：startSession 先写入 sessions，再检查恢复门。门关闭时检查抛错，被 catch 转为带 spawnError 的会话，但该会话留在表里。恢复后的 ensureSession 对相同 runId 直接返回，restoreRecoverySubscribers 也跳过 spawnError 会话。
- **触发条件**：修复已销毁旧日志会话但尚未解锁时，打开日志窗/面板并订阅一个仍在运行的 AVD。正常用户操作即可到达，不需要伪造 IPC。
- **影响**：服务恢复后日志继续报 logcatSpawnFailed；再次订阅仍失败，未重新启动日志进程。单纯重开日志面板不能清掉该会话壳。
- **隔离复现**：用真实日志管理器与假子进程建 AVD 会话并订阅 → suspendForAdbRecovery → 锁门 → 再次订阅 → 解锁并调用 restore/ensureSession → 再订阅。输出 `stillFailsAfterUnlock=true, error=logcatSpawnFailed, logcatSpawns=1`；唯一一次 spawn 是最初那次。
- **建议方向**：锁内在写入会话表前拒绝订阅，或恢复时丢弃/重建失败壳；补“修复中打开日志，修复后自动恢复”的交叉测试。仅记录，不修复。

## P2-3：旧连接晚完成会删除当前 UI 使用的新诊断凭据

- **位置**：`src/main/devices/wirelessRecovery.ts:183–190`；UI 只忽略旧响应，见 `src/renderer/src/components/DeviceListPane.tsx:288–298`。
- **观察**：每个失败 attempt 完成时无条件 forget(owner)，没有按开始顺序或请求代次判断。主窗允许对不同 USB 行先后发起转无线，UI 的 promoteRequest 只能忽略旧返回，不能保护 main 中的新上下文。
- **触发条件**：同一窗口的请求 A 尚未结束时发起 B；B 先失败并显示操作按钮，A 稍后失败。
- **影响**：A 删除 B 的 attemptId；用户点当前 B 的“复制诊断”或“修复连接”立刻得到“诊断已过期”，尽管刚刚生成。只能再次连接生成新诊断。
- **隔离复现**：同 owner 执行两个真实 WirelessRecovery.attempt；阻塞 A，先完成 B 并成功复制 B 的诊断；释放 A 后再复制 B。输出 `visibleLatestAttemptInvalidated=true, error=诊断已过期，请重新连接后再试`。
- **建议方向**：主进程按窗口维护请求代次，只允许最新请求替换上下文；或每次 attempt 独立保留至容量/TTL 清理。补完成顺序倒置测试。仅记录，不修复。

## 验证与评审边界

- 隔离脚本位于本机 `/tmp/msd-wireless-review.cjs`，用 TypeScript transpileModule 和 vm 加载当前源码，仅替换 Electron、进程与连接接缝；未向真实设备发送命令，未重启真实 ADB。
- 重跑现有 wirelessRecovery、adbRecovery、logcat、scrcpy、WirelessRecoveryFeedback 测试：5 文件、76 项通过。全绿不覆盖上述三个交叉场景。本轮未重复全仓构建/测试；上轮完整门禁证据保留在 [验证记录](../../../docs/poc/2026-11-05-wireless-recovery.md)。
- 八项 checklist 均检查：本轮发现集中在并发与执行门覆盖；未把暂缓的 USB 扩展、尚未执行的硬件组合或纯样式偏好列为缺陷。

## 修复处置（2026-11-05，用户明确授权后的独立修复轮）

- [x] P2-1：截图接入同一命令门与 pending 计数；子进程 close/error 与同步 spawn 异常幂等释放，超时提前返回至 close 之间仍在途。新增 screenshot/__tests__/adbRecovery.test.ts 覆盖。
- [x] P2-2：恢复门检查移至 startSession 创建会话之前；锁内订阅不写失败壳，同 runId 解锁后 restore/ensure/subscribe 成功，原订阅和新订阅均收到恢复数据。
- [x] P2-3：每个 attempt 独立保留，完成时不再 forget(owner)；既有容量/TTL/关窗清理不变，慢 A 晚于快 B 完成后，B 的复制与修复继续有效。

回归先在原代码上失败，再在修复后通过；全仓 1597 项通过、6 项跳过；build/typecheck、lint、Prettier 通过。修复 diff 复审无新增阻塞项。三项代码问题销账；合并记录见 [修复计划](../../../plans/2026-11-05-wireless-recovery-review-fixes.md)。前文保留原审查证据，不代表当前仍未修复。
