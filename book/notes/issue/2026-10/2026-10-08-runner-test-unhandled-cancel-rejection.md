---
description: runner.test.ts「disposeAll 打断挂起的 beforeStart」用例遗留一条 unhandled rejection（启动已取消），测试仍全绿但污染全量输出
status: resolved
tags: [vitest, runner, unhandled-rejection, 测试卫生]
---

# runner.test.ts 的取消路径泄漏一条 unhandled rejection

## 问题

全量 `npm run test` 结束时报 1 条 Unhandled Rejection：`Error: 启动已取消`，来源 `src/main/emulator/__tests__/runner.test.ts:548`（「disposeAll 打断挂起的 beforeStart：StartCancelledError 收口，不进 ADB/spawn」）。用例本身通过，601 项测试全绿；但 Vitest 把它列为 Errors，干扰「全绿即干净」的判断——每轮全量都会出现这条噪音，真实的新泄漏容易被淹没。

## 复现

```bash
npm run test   # 结尾 Unhandled Errors 段：Error: 启动已取消 → EmulatorRunner.cancelStart → runner.test.ts:548
```

## 建议方向

`cancelStart`/`disposeAll` 里 `preparing.abort.abort(new StartCancelledError())` 使某条 promise 链以拒绝收尾，而该链在测试替身路径上没有被 `.catch(() => undefined)` 覆盖（生产路径 `await preparing.result.catch(...` 已覆盖）。修复应在 runner.test.ts:548 附近补上对被 abort 的 promise 的兜底，或让测试替身走与生产一致的收尾路径；不动 runner.ts 生产逻辑。

## 备注

- 首次出现在本轮（2026-10-08 配置编辑实现轮）全量之前的基线里即存在——与 plan 2026-10-08-device-config-edit 的改动无关，按「只记录不修复」入册。

## 2026-10-09 已修复

取消前先绑定 start 的 rejects 断言，再 disposeAll、推进 tick 并等待断言，保留 StartCancelledError 语义。全量 npm run test：646 项通过、6 项跳过，无 Unhandled Errors。此问题只修改测试的观察时序；本轮 runner 新增的 afterBoot 恢复关卡属于独立的挖孔恢复需求。
