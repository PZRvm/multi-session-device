---
description: devices 域测试 harness 的三个坑：多域测试 handlerFor 必须取最后注册、clearAllMocks 不清 per-test 实现、EmulatorRunner 工厂参数是 () => 值
tags: [testing, vitest, harness, emulator]
---

# devices 域 harness 多域测试的三个坑

- **Scenario**: 在同一测试内多次 `freshDomain()`（模拟应用重启/扫描投影），或给 EmulatorRunner 注入依赖。
- **Why**:
  1. `handlerFor` 用 `find` 永远命中**第一个**域注册的 handler——第二个域的调用被路由回第一个域的模块状态，症状是"投影/状态没生效"而不是报错。已改 `findLast`（harness.ts）。
  2. `vi.clearAllMocks()` 只清调用记录，**不清** `mockResolvedValue/mockImplementation` 等 per-test 覆写——相邻用例的实现会泄漏（如 tcpProbe 恒 true、quit 恒 reject）。beforeEach 必须把所有可覆写 mock 重新播种。
  3. `defaultBootProbe` 的参数是 `() => string` 工厂；传字符串后 probe 每轮抛 TypeError 被 bootWait 吞成"未启动"，runner 永远停在 starting 且无任何报错——静默且难查。
  4. freshDomain 内部固定把 createRunner 接回假 runner——测试里提前注册的真实实现会被它覆盖。已加 `freshDomain({ useFakeRunner: false })` 选项；症状是「serial 是假实例硬编码值、spawn 永不发生、无任何报错」。
  5. runner spawn 失败（'error' 事件）此前无监听：静默死亡且 boot 等待毫无痕迹。已补 error 日志监听（顺带防未捕获异常击穿主进程）。
- **How to apply**: 多域用例在 freshDomain **之后**播种 store/metas（它会清内存态）；自定义 adb/bootProbe 依赖先看签名再传。
- **Evidence**: 2026-11-06 休眠域测试调通过程（本仓库 hibernationLifecycle.test.ts / smoke.real.hibernation.test.ts）。
