---
description: vi.clearAllMocks 只清调用记录不重置实现——上一组 describe 末用例设置的持久 mockRejectedValue 会渗进下一组，报错栈指向别的用例的 setup 行
tags: [vitest, mocking, test-isolation, gotcha]
---

# clearAllMocks 不重置实现，mock 状态跨 describe 泄漏

- **Scenario**: 同一测试文件多个 describe 共享 `vi.hoisted` 的 mock 对象，各组 `beforeEach` 都先 `vi.clearAllMocks()`。某组**最后一个**用例给 `mocks.deleteAvd.mockRejectedValue(...)` 设了持久拒绝实现，下一组 `beforeEach` 没有重新武装这个 mock——下一组里第一个真调它的用例直接吃到拒绝，报错栈指向上一组那条 setup 行（error 对象在构造点取栈），看起来像「别的用例害死了我的用例」。
- **Why**: `clearAllMocks` 等价逐个 `.mockClear()`——只清 calls/instances，**实现原样保留**；`resetAllMocks` 才重置实现。原有用例碰巧都不触达泄漏的 mock（如只断言「不删 AVD」），泄漏就长期潜伏，直到有人写第一个 happy path 用例才引爆。
- **How to apply**: 每组 describe 的 `beforeEach` 自己兜底**本组会触达的全部** mock 基线，不依赖上一组的收尾状态（尤其 `mockRejectedValue`/`mockReturnValue` 这类持久实现；`mockRejectedValueOnce` 用完即弃风险小）。症状识别：失败用例的报错栈指向另一条用例的 setup 行，先查 mock 实现血缘。案例：`src/main/devices/__tests__/index.test.ts`（2026-10-05 修，第二组 describe 补 `createAvd`/`deleteAvd` 基线）。
