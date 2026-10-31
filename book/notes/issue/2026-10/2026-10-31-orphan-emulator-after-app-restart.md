---
description: 应用重启后上代 headless 模拟器进程存活成孤儿——runningCount 预检看不见，迁移与活体模拟器抢镜像文件（EPERM）；P3「孤儿进程」验收项的真机实证变体
created: 2026-10-31
tags: [windows, process, migration, acceptance]
---

# 应用重启遗留孤儿模拟器——文件域预检失明，迁移撞 EPERM

## 现象（2026-10-31 真机）

矩阵修复（5f5e0ca）后迁移正常启动：评估弹窗出现、逐条目搬移、journal 记账正确（cmdline-tools/emulator/jre/platform-tools 等全部 done）。搬 `system-images`（8.2G）时失败：`EPERM: rename '...\AndroidSDK\system-images' -> '...\androidsdk\system-images'`。占用者为存活的 `qemu-system-x86_64-headless`（2.9G 内存）——Windows 目录 rename 要求整棵子树零句柄，qemu 映射着 system.img。

## 根因链

1. **孤儿进程**：用户验收期间多次重启 `npm run dev`；上代应用启动的 headless 模拟器（无窗口、投屏走 scrcpy）在应用退出后存活。win32 spawn「不 detached」（P3）只影响控制台信号，不提供父死随亡（无 job object）——应用重启后 RunnerRegistry 清零，进程却还在。
2. **预检失明**：`startSourceMigration` 的 `runningCount` 读的是应用内 RunnerRegistry——重启后恒 0，放行迁移；迁移与活体模拟器竞争镜像文件。P4 的 fsWin 重试（EPERM/EACCES/EBUSY，10×100ms≈1s）只救瞬时锁（杀软扫描），对持续占用（活体进程）按设计放弃并抛原错——行为正确，重试窗口不该背锅。
3. journal 可重入设计正确接住中断：已搬条目不回滚、失败条目可续跑（实测清掉占用者后重试即恢复）。

## 影响

- 迁移/任何按目录 rename 的文件操作（含后续可能的卸载）与遗留模拟器竞争；headless 无窗口，用户对占用无感知，EPERM 报错也无从归因。
- darwin 同理存在（重启后孤儿 qemu + registry 清零），win32 只是先撞上。

## 修法方向（记录不修）

- 候选 A（收养）：应用启动时扫描遗留的 emulator/qemu 进程（按 sdk 根路径或命令行特征匹配），收养进 RunnerRegistry 或提示用户清理。
- 候选 B（预检加固）：文件域重操作前做进程级占用探测（openfiles/Restart Manager 成本高，慎入）。
- 倾向 A——与 P3 既有进程池抽象对齐；真机补验迁移前先确认无 qemu 存活。

## 验收期 workaround

迁移报 EPERM 时：任务管理器（或 `tasklist`）查 `qemu-system-*`，`taskkill /PID <pid> /T /F` 清树后回设置页重试迁移——journal 自动续跑，仅失败条目重试。本次实测：杀掉 PID 22040 树后无残留。
