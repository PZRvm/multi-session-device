---
description: 来源感知列表批经验——vi.resetModules 后静态 import 成旧模块（测试设态必须动态重取同实例）；每调用现建 deps 的模块没有单例拦截点，监听器注册表是全覆盖分流的正解
created: 2026-10-12
tags: [testing, vitest, mock, module-scope, electron, ipc, event-listener]
---

# freshDomain 模块重置陷阱 / 现建 deps 的拦截点设计

来源：plan 2026-10-12-device-list-source-aware 实现批（worktree feature/device-list-source-aware）。

## 1. `vi.resetModules()` 后，测试文件顶部的静态 import 全部成旧模块

devices 测试的 `freshDomain()` 里 `vi.resetModules()` + `await import('..')` 重建被测域——域内 transitively import 的 sdkSource 也是**新实例**。测试文件顶部静态 import 的 `setSdkSourceState` 写的是旧实例的内存态，域内 `isSharedReadOnly()` 读新实例，静默分叉（用例拿默认值，不报错，极难排查）。

- 正解：设态在 `freshDomain()` **之后** `await import('../../emulator/sdkSource')` 动态取——resetModules 后同注册表的动态 import 与域内拿到的是同一实例。
- 判据：凡「测试先设模块态 → freshDomain 重建 → 断言行为」的用例，设态动作必须发生在重建后且经动态 import；反例如 sdkSourceSwitch.test 不 resetModules，静态 import 才是安全的。

## 2. 每调用现建 deps 的模块，没有「登记点包装」的落点——监听器注册表兜底

plan 轴 4 原设计「登记点包装 broadcast 单点拦截」假设 broadcast 依赖是注册时注入的单例；实际 `sdkSourceSwitch` 各公开入口（switchSource/startSourceMigration/clearRetainedRoot/…）都以**默认参数每次现建** `createSwitchDeps()`，无单例可包，逐入口改签名又是五处散点。

- 正解：模块内开 `let listener` 注册表 + 导出 `onSdkSourceChanged(listener)`（沿 devices 域 `attachDeviceStreamBridge` 先例），在 deps 工厂内包装 broadcast 分流——发射点零感知，登记点（ipc/index.ts）一行接线，五个发射点全覆盖。
- 代价：单监听器覆盖式注册，测试间要手动复位（本文件测试尾部 `onSdkSourceChanged(() => {})`）；多监听需求出现时升级数组。

## 3. 出身类静态标注的「两桶」划分要与迁移语义对表

`imageSourceOrigin` 取值 app-owned/shared-studio 两桶而非 managed/custom/shared 三态——因为托管↔自选迁移不跨越自有/共享边界（迁移=镜像跟着根走，设备可启动性不变），两桶标注永不过期；三态标注反而会在迁移后产生「出身写 managed、根已 custom」的假过期。设计来源类字段时先对表迁移矩阵再定取值粒度。

## 4. zustand store 是模块级单例——测试间状态必泄漏，断言默认值先显式复位

`useDeviceStore` 在模块层 `create()` 一次，vitest 同文件内所有用例共享同一实例：前一个用例把 `sourceBucket` 置成 `shared-studio`，下一个用例断言「默认 app-owned」就拿旧值（顺序依赖，单跑绿全跑红）。跨文件不泄漏（每文件新模块注册表），同文件必泄漏。

- 正解：断言默认值前 `useDeviceStore.setState({ sourceBucket: 'app-owned', revision: -1 })` 显式复位；或者一个用例内做完全部翻转断言。
- 同族坑：store 的 `apply` 用 `??` 回落当前值时，测试要演练「缺席回落」必须显式传 `undefined`（extras 展开 undefined 才会覆盖默认）——测试 helper 给了默认值就永远测不到回落分支。
