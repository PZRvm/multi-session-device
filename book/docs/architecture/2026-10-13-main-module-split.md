---
description: main 进程模块拆分快照——devices 域从 2603 行单文件拆为薄 index + 10 个域模块、emulator/index.ts 拆为装配层 + 4 个 sdkIpc 分组；分层 DAG 与状态访问器规则
created: 2026-10-13
---

# main 进程模块拆分（devices + emulator）

源码依据为 dev 的拆分系列提交（D1–D9 + E1–E3，plan [2026-10-13-main-devices-emulator-split](../../plans/2026-10-13-main-devices-emulator-split.md)）。纯机械搬移：IPC 契约、行为、文案、测试断言零变化；全量 1139 测试保持通过。Android 运行链路的语义仍以 [2026-10-08 运行快照](2026-10-08-android-runtime.md) 为准，本文只更新模块落点。

## devices 域（原 index.ts 2603 行 → 10 文件 + 20 行出口）

分层为 DAG，禁止经 index 中转：

```text
environment / state        →  路径单源、adb/端口/载荷守卫；跨组共享状态 + Now()/set 访问器
        ↓
persistence                →  首载恢复、受控重读、串行写队列、commitMetas/commitMetasWithConfig、写守卫
        ↓
scan / startup / lifecycle / create / edit   →  对账与首载编排；启动核验+runner 装配；启停/删除/退出清理；创建事务；配置编辑域
        ↓
queries / ipc              →  只读查询（跨域注入消费）；13 个 handler 纯转发 + sender 白名单
        ↓
index.ts（20 行纯 re-export，17 个公共符号）
```

状态归属规则（本次拆分的关键决策，后续加状态沿用）：

- **单写方持有的 `let` 留在持有者文件**：loadPromise→scan、writeQueue/acceptedMetas→persistence、reconcilePromise/acknowledgedSignature→scan、deleteFlights→lifecycle、adbExecutable→environment、skinDownloading→sdkIpcSkins。
- **跨组读写的进 `state.ts`**：ESM `let` 导出不可外部赋值，可重赋值者配 `xxxNow()` 读 + `setXxx()`/`bumpXxx()` 写（命名沿文件内既有的 `-Now` 快照惯例）；Map/Set 等绑定稳定者直接 const 导出（editFlights/frozenMessages/streamBridge）。
- **单例语义**：`__tests__/index.test.ts` 的 `vi.resetModules()` + 动态 `import('..')` 依赖整图重载——全部子模块经 index 依赖图加载，拆分后语义保持（测试零改动，保留为域级集成测试）。

## emulator 域（原 index.ts 711 行 → 装配层 + 4 分组）

registerSdkIpc 单体（484 行、约 20 个 handler）拆为：

| 文件 | 职责 |
| --- | --- |
| `sdkIpcShared.ts` | resolveRoot/推送/许可框/sender 守卫/写守卫/requireSdkReady + 画像·镜像·皮肤缓存与下载互斥的函数式访问器 |
| `sdkIpcSource.ts` | sdkStatus + 来源域 9 handler + 级联计数 + 目录选择器 + bootstrap |
| `sdkIpcCatalog.ts` | sdkProfiles / sdkImages / sdkWizardCapabilities |
| `sdkIpcSkins.ts` | 皮肤呈现/清单/导入/下载 + 摄像头（皮肤下载互斥私有） |
| `sdkIpcImages.ts` | 镜像卸载/下载/取消 |
| `index.ts`（24 行） | registerSdkIpc 装配 + re-export defaultAvdHome/onSdkSourceChanged/SdkIpcDeps |

镜像清单缓存有两种命中语义别混用：`freshImagesFor`（60s 时效，展示路径）与 `imagesFor`（仅 root 匹配，卸载/下载守卫路径——宁可旧数据不冒充最新）。

## 消费方零改动清单

`src/main/ipc/index.ts`（devices 14 个符号 + emulator 3 个）、`src/main/index.ts`（prepareAppShutdown/resumeAfterShutdown）、`emulator/sdkSourceSwitch.ts`（runningDeviceCount，仓库唯一 emulator→devices 依赖）、`devices/__tests__/index.test.ts` 的 import 路径全部不变。
