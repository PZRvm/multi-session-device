---
description: 持久化对账实现轮的四条硬经验——fake timers 与真实 fs 的共存法、clearAllMocks 的返回值泄漏、绝对路径段判逃逸、单飞 mock 的 resolver 时序
tags: [vitest, 测试接缝, mock 泄漏, 路径安全, electron]
---

# 对账实现轮的测试与路径判定经验

**场景**：`plan 2026-10-05-avd-reconciliation` 实现轮（feat/avd-reconciliation 分支）；全量 502 项测试通过时沉淀。

## 1. vi.useFakeTimers 与真实 fs 可以共存——限住 toFake

测「3 秒检查超时」时既要假计时器推进 3000ms，又要真实 `fs` 回调（libuv 线程池）继续跑。默认 `useFakeTimers()` 连 `setImmediate` 一起假掉，真实 IO 永远不被冲刷，promise 链挂死、用例超时。解法：

```ts
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
// 真实 IO 用若干轮 setImmediate 冲刷到挂起点，再 advanceTimersByTimeAsync(3100)
for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r))
```

## 2. vi.clearAllMocks() 不清 mockReturnValue / mockResolvedValue

一个 describe 里 `mockResolvedValue(missing)` 会渗进后续 describe（实现还在、返回值还是旧的），表现成「后一组用例莫名失败」。跨 describe 共享 mocks 对象时，beforeEach 必须显式重置有状态的方法（`mockReturnValue(默认)`），不能只 clearAllMocks。

## 3. 绝对路径 split(sep) 的首段是空串——不是逃逸段

`'/a/b'.split('/') === ['', 'a', 'b']`。路径逃逸判定若要求「每段非空」会把所有绝对路径判成越籍（本仓 macOS tmp 目录经 `/var → /private/var` 一放大，全量误报 unsafe）。正确判据：只看 `'.'`、`'..'`、NUL；`'//'` 空段 join 会折叠、无穿透能力。词法判定之外，真正的根外指向交给 `realpath` + 前缀包含（`isWithin`）。

## 4. 单飞（single-flight）mock 的 resolver 在微任务后才赋值

测试「并发两次调用共享一次扫描」时，把 pending promise 的 resolve 存进外层变量，然后在**同步代码里立刻调用它**——此刻 mock 还没被调用，变量是 undefined，`release?.()` 静默 no-op，挂起的扫描永远不释放、用例超时。先 `await vi.waitFor(() => expect(typeof release).toBe('function'))` 再释放。

## 5. 顺带：devices 域测试的 store mock 适配层

devices 域测试里 mock `'../../store'` 时做了一层适配（`readDeviceStore: async () => ({ metas: await mocks.readDeviceMetas(), health: mocks.storeHealth(), ... })`），让几十个旧用例的 `mocks.readDeviceMetas.mockResolvedValue([...])` 原样可跑，新用例只覆写 `storeHealth`——改动面最小的双版本迁移法。

## 6. 真机数据当场抓到的教训：mock 适配层全绿 ≠ 校验路径被覆盖

实现轮收尾后用户实机一跑就触发「整库写保护 + 设备行消失」：`firstInvalidV2Field` 把合法的
`screenSummary: null` 判成坏条目（该函数只放行了 `advancedSettings` 的 null 短路）。
502 项测试全绿却没拦住，因为 devices 域测试 mock 了 `../../store`（见第 5 条的适配层）——
**适配层让旧用例零改动跑通的同时，也把真实校验函数从所有高层测试里摘了出去**；而 store
自己的测试 fixture 全部带 screenSummary 对象，null 分支零覆盖。

结论：**字段校验函数里每个接受 null 的分支，都必须有一条直达 `readDeviceStore` 的同构
fixture 测试**（逐字段抄真实落盘记录），mock 再全面也替代不了这一层。回归锚见
`store.test.ts` 的「真实数据回归」用例。
