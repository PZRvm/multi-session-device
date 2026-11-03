---
description: devices 域测试挂具的两个坑——双 freshDomain 的 handlerFor 取首个注册、mock start 固定 runId 与按代次隔离机制的映射失配
tags: [testing, vitest, devices, runner]
---

# devices 域测试挂具的两个坑

适用场景：在 `src/main/devices/__tests__/index.test.ts` 写涉及模块级状态（acceptedMetas、runId 隔离表）或多次 `freshDomain()` 的用例。2026-10-09 补充复查修复轮各踩一次，各耗一轮调试。

## 坑 1：一个测试里第二次 freshDomain 后，handlerFor 还是第一个实例的

`freshDomain` 用 `vi.resetModules()` + 动态 import 隔离模块级状态，但 `handlerFor` 从 `mocks.handle.mock.calls.find(...)` 取**首个**注册——第二次 import 后 `handle` 上堆了第二个实例的注册，`find` 仍返回第一个实例的闭包。于是"新域"的调用实际跑在旧实例上：旧实例不重新加载（loadPromise 已缓存）、`acceptedMetas` 停在它最后一次提交，而 `fileMetas.current` 已被新 freshDomain 清空——CAS 两边不一致，报"devices.json 已被外部修改"。

**修法**：同一用例内需要"干净状态"时不要开第二个 freshDomain；要重验行为就在同域重新取指纹/重新提交。既有测试里双 freshDomain 之所以碰巧能用，是因为第一个实例没发生过写盘。

## 坑 2：mock 的 runner.start 返回固定 runId，按 runId 隔离的机制全部失配

`startThroughPreflight` 的 mock 返回硬编码 `{ runId: 'run-1' }`，而生产语义是 runner 回显调用方传入的 attemptId（`startDevice` 先把行内 runId 设为 attemptId，再用返回值覆盖）。按 runId 隔离的映射（displayArgsByDevice、cameraOverridesByDevice、cameraNotice 的代次守卫）键是 attemptId、行内值是 'run-1'——守卫恒 false，覆盖被静默忽略，测试表现为"机制没生效"。

**修法**：测按代次隔离的行为时，用自己的 start mock 回显传入 runId（`async (id, runId) => ({ runId, serial })`），需要 running 态就从 devicesList 快照取行内真实 runId 再喂给 `onRunning`。

## 顺带

`mockImplementation` 会跨用例泄漏（beforeEach 的 `clearAllMocks` 只清调用记录不清实现）——临时改 `settingsToRunnerArgs` 这类共享 mock 时用 `mockImplementationOnce`，否则污染同文件后跑的用例。
