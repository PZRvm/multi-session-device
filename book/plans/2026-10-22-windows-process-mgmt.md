---
description: 进程管理 Windows 化——runner 树杀 taskkill /T、detached 平台化与 windowsHide、before-quit 关窗确认弹窗（有设备在跑先确认再退出）；Win P3，依赖外围调研与用户批复
status: completed
created: 2026-10-22
---

# Windows 进程管理 — plan

> 实现记录（2026-10-22，feature/windows-process-mgmt，基 dev c77fbe4）：按 Build order 全部完成。runner `killGroup` 平台分支 + `defaultKillTree`（taskkill /PID /T /F，竞态 3s 宽限 + 有界重试一次，失败保留 entry）+ `spawnEmulator` posix-only detached / 恒 windowsHide；新增 `src/main/quit-confirm.ts` 与 `before-quit` 接入（留在应用折返，quitPending 由既有 finally 复位）。**三处实现偏差**：① 确认逻辑抽独立模块 `quit-confirm.ts`（index.ts 副作用重不可直测，dialog 域是 IPC 注册模块不合适）——Impact range 实际多两个新文件（含 `__tests__/quit-confirm.test.ts`）；② i18n 落四键非三键——「退出」按钮文案独立成 `quitConfirmQuitButton`（复用 quitStayButton 做「留在应用」），避免误用「强制退出」的既有语义；③ `defaultKillTree` 加 `spawnFn` 可选接缝参数——vitest 下 `vi.spyOn` 打不通 node 内置模块的 ESM 命名空间（learn 2026-10-22-vitest-esm-namespace-spy）。全套 1327 测试过（新增 12：win32 树杀 7 + quit-confirm 5）、typecheck/lint 0 错、mac 侧既有用例零改动。真机项（多开关窗弹窗、孤儿进程检查、taskkill 真实行为）归统一集成验证阶段。

> 依据：[外围调研](../notes/think-report/20261022110137-Windows兼容问题解决方案调研.md) §2（A1 树杀 / A4 windowsHide）与 2026-10-22 用户批复：**不做托盘；Windows 关窗即退出，但退出前若有本工具启动的设备在跑，先弹确认框**。任务清单见 [todos](../todos/windows-support.md) P3。
> 与 P1 无代码依赖（不同文件群），可并行施工；**明确不与 P1 的 platformExec 合并**——runner 管长驻进程池（detached/stdio/崩溃监听），与引导链短命令执行器需求不同，合并即引入无谓抽象（两 plan 已约定平行维护）。

## Requirements brief

- 作用域：`runner.ts` 停止路径的 win32 树杀（`taskkill /PID <pid> /T /F`）与 `detached`/`windowsHide` 平台化；`src/main/index.ts` `before-quit` 序列头部加 win32 关窗确认弹窗（有运行中设备时）；i18n 三语文案。
- 排除项：优雅退出（emulator console `kill`，backlog A2——win32 首期无优雅层，见设计 1 的如实记录）；托盘（已拍板不做）；`platformExec` 统一（不建）；`devices/lifecycle.ts` 不动（确认弹窗用现有 `runningDeviceCount` 导出，`devices/index.ts:8`）。
- 边界：全部 win32 条件分支；posix 停止路径（负 PID 进程组 + SIGTERM→SIGKILL 梯子）逐字节不变；确认弹窗只在 win32 且有活动设备时出现，其余路径零变化。
- 验收要求：win32 树杀/弹窗分支单测覆盖；mac 全套既有用例零改动全绿；弹窗「留在应用」中止退出流程且可再次发起关窗（幂等）、「退出」走完整既有清理链。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/main/emulator/runner.ts` | `killGroup` 平台分支（win32 `taskkill /PID /T /F`，posix 现状）；`#spawnFor` 的 `detached` win32 置否、spawn options 补 `windowsHide: true`；deps 注入 `killTree` 接缝供单测 |
| `src/main/index.ts` | `before-quit` 序列在 `quitPending = true` 之后、`prepareRecordingQuit` 之前插入：win32 且 `runningDeviceCount() > 0` → `dialog.showMessageBox` 确认；「留在应用」→ 复位 `quitPending` 并返回（不 quit）；「退出」→ 继续既有链 |
| `src/shared/i18n/errors.ts` | `quitConfirmTitle` / `quitConfirmMessage`（带设备计数占位）/ `quitConfirmDetail` 三语，与 `quitCleanup*` 同域同风格 |
| `__tests__/`（runner / main） | win32 树杀、detached 选项、弹窗三分支用例 |

风险：`taskkill` 失败形态（进程已退出时 `/F` 报「找不到进程」非零退出）。处置：killTree 结果与 `entry.child.exitCode` 竞态合并——child 已退出视为成功收口（对齐现状 `alive` 判定 `:423`）；真失败保留 entry 供重试（现状口径）。弹窗期间用户再点窗口关闭：`quitPending` 守卫已挡重入（`:59`），弹窗 resolve 后按选择走。

## Design

1. **树杀（win32）**：`killGroup` win32 分支调 `killTree(pid)`：`spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })`，非零退出且 child 仍活 → 有界间隔重试一次 → 仍失败按现行「失败保留 entry 供重试」收口。**如实记录**：win32 首期无优雅层——`-no-window` 模拟器无消息循环，`taskkill` 不带 `/F` 无效，且 Windows 上 SIGTERM 本就映射硬杀；AVD 锁残留由既有「残留实例显式拦截」（`runner.ts:172`）兜底；优雅路径归 A2（console kill）backlog。posix 分支（负 PID + 两级信号梯子）零改动。
2. **spawn 平台化**：`#spawnFor` options——`detached: process.platform !== 'win32'`（win 下 detached 会开新控制台且与 windowsHide 冲突，nodejs/node#21825）；`windowsHide: true` 两平台恒加（posix 无副作用）；stdio 管道配置不变（stdout 致命错误捕获语义保留，`:283`）。
3. **关窗确认弹窗**：插入点在 `quitPending = true` 之后、既有清理链之前；条件 `process.platform === 'win32' && runningDeviceCount() > 0`；`dialog.showMessageBox`（type warning、buttons `[留在应用, 退出]`、cancelId=0、icon appIcon，对齐同文件 `quitCleanup` 弹窗风格）；「留在应用」→ `quitPending = false`、直接 return（应用留在原状，用户可再次关窗重走全流程）；「退出」→ 落回既有 `prepareRecordingQuit → prepareAppShutdown → shutdownStreams → ...` 链。mac 无关窗退出路径（`window-all-closed` 不 quit，`:48`），弹窗永不触发。
4. **i18n**：三键三语（zh-CN / zh-TW / en），message 用 `{count}` 占位接 `format`，与 `quitCleanupMessage` 同构。
5. **不做**：托盘、图标、通知；`prepareAppShutdown` 及 leftovers 弹窗（停不掉才弹的那道，`:74-87`）不动——两道弹窗语义不同（本 plan 是「停前确认」，既有是「停失败仲裁」），并存。

## Build order

1. runner `killTree` 接缝 + win32 分支 + detached/windowsHide 平台化 + 单测（win 断言 taskkill 参数与 windowsHide、不设 detached、child 已退出的竞态收口、重试后失败保留 entry；posix 用例零改动回归）。
2. i18n 三键三语。
3. `before-quit` 确认弹窗 + 单测（win 有设备弹窗/留在应用中止且 quitPending 复位/退出走完整链；win 无设备不弹；mac 永不弹——mock `dialog`/`app`，参照 window 域测试既有 mock 风格）。
4. 全套回归 + typecheck/lint + book 收尾。

## Test plan

- 单测（runner）：killTree 调用序列（`/PID <pid> /T /F`、windowsHide）；win32 不 detached；posix 负 PID 与信号梯子回归不变；失败重试与收口。
- 单测（main）：弹窗四分支（win×有无设备、mac、重入守卫）；「留在应用」后再次 quit 流程可重走；「退出」链路调用顺序断言。
- 回归：全套既有用例零改动；typecheck/lint/prettier。
- 真机（延后到统一集成阶段）：win 上多开 2 台模拟器 → 关窗弹确认 → 留在应用设备继续 → 再关窗确认退出 → 任务管理器无孤儿 qemu/emulator 进程、5554+ 端口释放；强杀路径 AVD 锁残留的下一次启动拦截表现。

## Done criteria

- 全套测试全绿且既有用例零改动；win32 树杀与弹窗分支单测齐；三语文案落位；「不建统一执行器」注记在 runner.ts 代码注释与两 plan 中一致；调研报告 §2（A1/A4 与决策项）落地路径逐条对上；book 收尾完成。
