---
description: devices 域 ensureLoaded 无互斥——首个命令与并发 IPC 同窗口时可能双读落盘文件，后者覆盖前者
---

# devices ensureLoaded 并发双读竞态

- **Observed**: 2026-10-03 stage 03 Phase 5 review 发现：`src/main/devices/index.ts` 的 `ensureLoaded` 用模块级 `loaded` 布尔做单次加载，无互斥。两个 IPC handler 在首载窗口内并发进入（如多窗口同时 `devices:list`，或 list 与 create 同帧到达），都会看到 `loaded === false` 并各自 `readDeviceMetas()`，后完成者以自己的读结果整体覆盖 `devices`——若第一个 handler 已在其读结果上叠加了变更，该变更会被第二个 handler 的覆盖卷走。
- **Reproduction**: 目前不易复现（renderer 启动只发一次 list，用户操作在秒级之后）；属窗口极窄的潜在竞态。理论路径：启动瞬间多窗口/多调用并发触发。
- **Suggested direction**: 把 `ensureLoaded` 改成缓存单例 promise（`loading ??= readDeviceMetas().then(...)`），并发调用共享同一次加载；或上简单 mutex。改动约 5 行，等后续轮次单独处理。

严重级：P3（单窗口 + 秒级人操作下窗口趋近于零，但违背「主进程单写者」的精神，stage 04 多窗口/多调用前应修）。
