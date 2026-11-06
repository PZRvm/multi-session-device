---
description: emulator console 的 snapshot save OK 只是受理而非写盘完成；缺失/半写/配置变化快照都会静默冷启动回退——完成判定与恢复复核的实测协议
tags: [emulator, snapshot, hibernation, console, android]
---

# Emulator 命名快照的实测协议（36.1.9，macOS/arm64）

- **Scenario**: 用官方快照实现"休眠"（保存→退出→恢复）或任何依赖 `-snapshot` 的功能。
- **Why（全部为本机 PoC 实证，证据 book/docs/poc/2026-11-06-hibernation-poc）**：
  1. `avd snapshot save <名>` 的 console **OK 只是受理**，写盘异步：冷缓存/双机下首字节 >20s、全程数十秒；单机热缓存下 OK 恰在写完后返回，极易误判为同步语义。
  2. 缺失快照名、保存中 kill -9 的半写快照、**硬件配置变化**（如 RAM 改动）三类场景全部**静默冷启动回退**——进程正常起、`sys.boot_completed=1`，只有日志 USER_INFO/WARNING 提示，boot_id 变化。
  3. 损坏快照（截断 ram 文件）→ 加载器原生崩溃（length_error）**悬挂**：既不 boot 也不 exit，只能靠外层超时杀进程。
  4. 运行中实例下删除快照目录再**同名**保存 → 返回 OK 但零字节。快照名必须唯一；旧快照只能在进程退出后清理。
  5. console kill 优雅退出（~2s），不覆盖所加载的快照（±`-no-snapshot-save` 实测一致）；token 路径以 greeting 原文为准（本机恒指 `$HOME/.emulator_console_auth_token`，即使设置了 ANDROID_EMULATOR_HOME）。
- **How to apply**: 完成判定 = 快照目录「首字节出现（预算 ≥90s）+ 大小稳定」；恢复成功 = guest `/proc/sys/kernel/random/boot_id` 与保存值一致，绝不能只等 boot_completed；不兼容在 spawn 前用指纹拦（qemu 只回退不拒绝）；console 客户端按 greeting→auth→命令状态机实现并以命令发出点切分响应。
- **Evidence**: G0 PoC 双机各五轮 + 六项失败矩阵；产品实现 `src/main/emulator/{emuConsole,hibernation}.ts`、devices 域休眠流；真机冒烟 save 10.1s/quit 2.1s/resume 2.1s。
