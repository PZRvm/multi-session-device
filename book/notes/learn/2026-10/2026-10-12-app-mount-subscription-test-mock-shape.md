---
description: 断网开关批经验——App 挂载期新增 window.api 订阅必须同步补齐既有测试的 mock 形状（22 项连环挂）；vi.fn mock 带参函数要显式参数类型
created: 2026-10-12
tags: [react, testing, vitest, window-api, mock, electron, ipc]
---

# 断网开关批：挂载期订阅的测试联动 / vi.fn 参数类型

来源：plan 2026-10-12-network-switch-group 实现批（feature/network-switch-group）。

## 1. App 挂载期新增 `window.api.*` 订阅会连环炸既有测试的 mock

新增 `useEffect(() => window.api.network.onChanged(...))` 挂在 App 挂载路径后，**所有渲染 App（含经 DeviceCanvas 间接渲染）的既有测试**只要 `window.api` mock 里没有 `network` 键就 TypeError——本批一次挂掉 4 个文件 22 项（App.logcat / App.reconciliation / App.wizard / DeviceCanvas.actions）。

- 根因：mock 是手工字面量，没有类型约束兜底——`window as { api?: unknown }).api = {...}` 写法 TS 不查形状。
- 修法逐文件补 `network: { set: vi.fn(async () => ({ state: null })), onChanged: () => () => {} }`。
- **经验**：动 App 挂载路径的订阅面时，先全局搜 `window.api` 的测试 mock 清单（`grep -rln "onRuntimeError" src/renderer/src/components/__tests__`）——`onRuntimeError` 是既有挂载期订阅的锚点，它出现过的 mock 都要补新键。新通道若也走挂载期，锚点名单就再涨一个。

## 2. `vi.fn` mock 带参函数必须显式参数类型

`vi.fn(() => Promise.resolve(undefined))` 是**零参签名**；被单参调用时 TS 报「签名参数太少」，且 `mock.calls[0][0]` 的元组类型是 `[]`，取下标也报错。正确写法把参数写进泛型：

```ts
const show = vi.fn<(options: { title: string }) => Promise<unknown>>(async () => undefined)
```

零参箭头体 + 泛型签名并存——实现忽略参数、类型如实描述调用面。

## 3. 轮询器的「不复活」finally 与首拍立即执行

设备侧轮询器两个细节（域单测各有一案）：`tick` 的 `finally` 里要**重新 get** watch 条目再清 inFlight——await 期间设备可能已被 clearWatch 清掉，直接持有旧引用会复活已死条目；`startWatch` 里 `setInterval` 之后**立即 `void tick(id)`**——首拍不等第一个间隔，设备启动即得初值推送（渲染层依赖初值点亮开关）。
