---
status: open
description: 休眠域评审轮发现：恢复后清单消费失败的陈旧投影风险、已休眠设备编辑无前置提示、quit 后 adb serial 残留影响紧接恢复
created: 2026-11-06
tags: [hibernation, emulator, snapshot, review]
---

# 模拟器休眠评审轮发现（record-only）

依据 plan 2026-11-06-emulator-hibernation Phase 5（只记录不修复）。实现与证据见
summary 2026-11-06-emulator-hibernation 与 ADR-007。

## P1 恢复成功后清单消费失败 → 陈旧休眠投影

- 问题：`consumeHibernationAfterResume`（startup.ts）删除 `msd-hibernation.json`
  失败时仅 `console.warn`。若该失败跨应用重启持续存在，启动扫描会把一个实际已
  「停止」的设备投影回 `hibernated`；用户此时恢复会加载陈旧快照——把设备状态
  回滚到上次休眠现场（“误复用旧快照”风险，plan 设计 B 明确要防）。
- 复现：恢复成功后对清单文件制造删除失败（如目录只读），重启应用。
- 建议方向：消费失败时在内存登记已消费事实并在本会话内重试删除；跨重启仍失败
  时把清单 stage 改写为终态（如 `consumed` 墓碑）而不是保持 `hibernated`。

## P2 已休眠设备的配置编辑无前置提示

- 问题：休眠中（hibernated）打开编辑窗保存配置不会被拦，用户要到点「恢复」才
  收到「指纹不兼容」错误（resumeIncompatibleFingerprint）。可恢复（放弃休眠后
  重启）但提示时点晚于 plan F 的「操作前提示」。
- 复现：休眠设备 → 编辑改 RAM → 保存成功 → 恢复被拒。
- 建议方向：read-config 快照对 hibernated 设备带提示字段（编辑窗口内横幅），
  保存时确认「将使休眠快照失效」。

## P3 quit 后 adb serial 短暂残留影响立即恢复

- 问题：console kill 后 adb server 侧 serial 注销有窗口；用户在窗口内点恢复会
  收到「serial 已被占用」（runnerSerialOccupied），需手动重试。真实状态无误报
  （端口 connect 探测已过），只是体验毛刺。
- 复现：休眠完成后 1–2 秒内立即恢复。
- 建议方向：resumeFlow 对该错误做一次有界退避重试（runner 启动前 serial 探测
  失败等待 adb 注销）。

## 2026-11-06 晚：用户实测缺陷修复轮（f72e2a2）

- 休眠提交后旧快照清理 keepName 误传 null → 恢复「快照缺失」（用户实测）：已修
  （keep=本次快照名；恢复后清单消费不再删快照目录），新增 devices 域全链路真机
  冒烟作回归层。本条与下方 P3 的「快照清理失败重试」合并观察。
- screen:ack 拆除窗口报错（用户实测）：ACK 静默容忍，已修。
- 新增 runner spawn error 监听（此前 spawn 失败完全静默）。
- P1/P2/P3 仍然 open；另发现：dev 单实例锁回退已实现（见 commit），原
  issue 2026-11-02-worktree单实例锁互斥 的方向落地于 src/main/index.ts。

## 已核对无问题的重点项（评审结论）

跨代次污染（runId/viewToken/截图缓存随 beforeKill 清空）、删除守卫位置（用户
通道最后一次异步加载后同步复核 stopped；内部级联 internal 直通）、半提交清单
（原子写 + saving 中断扫描解释为 stopped 附原因）、隐式冷启动（boot_id 复核 +
单测覆盖缺失/半写/配置变化三类回退）、失效快照清理（仅进程退出后、独占前缀）、
安装/截图旁路（进入 hibernating 后新截图被拒 + 在途有界排空）、平台能力误开放
（仅 darwin+host；Windows/软件后端禁用带原因）。
