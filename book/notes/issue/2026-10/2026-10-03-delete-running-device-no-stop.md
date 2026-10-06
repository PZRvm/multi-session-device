---
description: 删除运行中设备不先停机、不做运行态拦截——mock 阶段合理，stage 04 接真实 emulator 前必须补
---

# 删除运行中设备不先停机

- **Observed**: 2026-10-03 stage 03 Phase 5 review 发现：运行中的设备可以直接走删除流程（确认框 → `devices:delete`），主进程不检查 `status`。mock 阶段无真实进程，语义无害；stage 04 接真实 emulator 后，这条路径意味着「emulator 子进程还活着，AVD 目录却被删了」。
- **Reproduction**: 点启动 → 设备「运行中」→ 点删除 → 确认 → 设备消失（无停机步骤）。
- **Suggested direction**: 主进程 delete handler 对 `running` 设备先走停机（等待退出/超时强杀）再删目录；或在确认框后果清单里明示「设备正在运行，将强制停止」。决策点：拦截（要求先手动停）还是级联（自动停+删）——建议 stage 04 设计时拍板。

严重级：P3 现状 / stage 04 升 P1（不修就会炸真实子进程）。记在这里作为 stage 04 的输入。

## 跟进（2026-10-05）——已修

stage 04 步骤 4（commit 7099076）落地**级联**方案：`deleteFlow` 对 starting 先取消、running/stopping 先停机并等退出，未回 stopped 不动 AVD 目录；删除确认框同步明示「设备正在运行：将先停止并等待退出，再删除 AVD」。测试在案：停止失败腿「delete：running 设备先经 runner.stop，停止失败不删 AVD」＋本批（plan 2026-10-05-device-store-issue-batch）补的 happy path「delete：running 设备先停后删——stop 先于 deleteAvd，落盘不含该 id」。
