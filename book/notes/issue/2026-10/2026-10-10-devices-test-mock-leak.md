---
description: P3（已修复）：devices 测试 Quick Boot 组的 readAvdConfigRaw.mockRejectedValue 未恢复，clearAllMocks 不清实现，后追加的 describe 被渗入导致顺序敏感
status: resolved
priority: P3
tags: [test, vitest, mock, devices, ordering]
created: 2026-10-10
---

# devices 测试 mock 实现跨 describe 泄漏

## 问题

`src/main/devices/__tests__/index.test.ts` 的「Quick Boot 运行路径」describe 里，用例「读取配置失败时启动失败」设置了：

```ts
mocks.readAvdConfigRaw.mockRejectedValue(new Error('AVD config.ini 读取失败'))
```

该用例结束后没有任何恢复。而各组 beforeEach 用的 `vi.clearAllMocks()` 只清调用记录、**不清实现**（同文件 905 行附近的注释自己点过这个坑：「上一组用例遗留的 reject 会渗进来，本组自己兜底」——但兜底只覆盖了该组用到的 mock）。

结果：任何追加在其后的新 describe，只要走 `devicesStart` 流程就会撞上这个遗留 reject，测试单跑（`-t` 过滤）通过、全量跑失败——典型的顺序敏感假绿。

拖拽 APK 批次（2026-10-10-drag-apk-install）新增 `runningDeviceSerial` describe 时即被渗入，绕法是在自己的 beforeEach 里显式 `mocks.readAvdConfigRaw.mockImplementation(async () => null)` 回缺省。

## 复现

1. 在 Quick Boot describe 之后追加一个调用 `devicesStart` 的 describe（不带 readAvdConfigRaw 兜底）；
2. `npx vitest run src/main/devices/__tests__/index.test.ts` —— start 被遗留 reject 拦下；
3. `npx vitest run src/main/devices -t "<新用例名>"` —— 通过。

## 建议

二选一（修复时）：

- Quick Boot 该用例结尾 `mockRestore` / 恢复缺省实现；
- 或把「全量 hoisted mock 回缺省」抽成共享 `resetMocksToDefaults()`，各组 beforeEach 统一先调它再叠自己的覆写（根治顺序敏感）。

## 处置记录 — 2026-10-10（修复批）

按建议方向其一（源头修复）处理：Quick Boot 组肇事用例的 `readAvdConfigRaw.mockRejectedValue(...)` 改为 `mockRejectedValueOnce(...)`——一次性拒绝用完即回 hoisted 缺省实现（`async () => null`），渗漏不再发生；用例行为不变（该流程只读一次配置，单跑与全量均通过）。`runningDeviceSerial` describe 的防御性 beforeEach 重置保留，作为对未来新肇事者的保险；未做全文件 `resetMocksToDefaults()` 集中化（churn 大，留待测试文件下次大改时一并考虑）。
