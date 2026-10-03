---
description: 手写 config 的 AVD 在快照恢复路径原生崩溃（SIGABRT）——PoC 固定 -no-snapshot 冷启动，快照加速在 v1.1 前需先解决
---

# 模拟器快照恢复原生崩溃

- **Observed**: 2026-10-04 PoC（emulator 36.1.9，Android 16 镜像，手写 config AVD）。第一次冷启动后 kill，第二次启动加载 `default_boot` 快照时崩溃：crash 报告 `qemu-system-aarch64-headless ... skin_winsys_quit_request → abort`，SIGABRT（`~/Library/Logs/DiagnosticReports/qemu-system-aarch64-headless-*.ips`）。冷启动（`-no-snapshot`）持续稳定。
- **Reproduction**: 手写 config AVD 冷启动 → boot 完成 → SIGTERM 停止（保存快照）→ 再次启动（不带 -no-snapshot，走快照恢复）→ 崩溃。PoC 期间复现一次；官方 Studio 建的 AVD 未验证。
- **Suggested direction**: 一期 runner（stage 04 步骤 4）固定 `-no-snapshot`（PoC 已如此）；PRD 5.1 的「快照恢复缩短冷启动」（v1.1 候选）实施前需先在目标镜像上复测快照稳定性，并核对是否与手写 config 缺键（如 fastboot.* 键族）相关。

严重级：P2（当前路径已绕开；阻塞 v1.1 快照加速候选）。
