---
description: 纯机械拆分 src/main/devices/index.ts（2603 行 → 薄 index + 10 个域模块）与 src/main/emulator/index.ts（711 行 → 薄 index + 5 个文件）；对齐 emulator 目录「薄 index + 域模块」样板，公共契约（17 个导出符号）不变，行为零变化
status: in_progress
created: 2026-10-13
---

# main 进程大文件拆分（devices + emulator）— plan

设计阶段（Step 0 / Phase 1 / Phase 2）在 2026-10-13 会话完成，用户批复：①拆分粒度「一步到位：薄 index + 域模块」②3400 行 devices 测试本轮保留为域级集成测试不动，按模块拆测试留作后续单独任务。

## Requirements brief — Step 0

### Background

`src/main/devices/index.ts` 已长到 2603 行（用户口径约 2000），混合了路径解析、核心状态机、对账报告、启停生命周期、创建/重命名事务、配置编辑域（713 行）与 IPC 注册。`src/main/emulator/index.ts` 711 行，其中 `registerSdkIpc` 单函数 484 行（68%）注册约 20 个 handler。emulator 目录本身已是「薄 index + 35 个域模块 + 测试随文件」的成熟样板（全仓最强组织惯例），devices 拆分即向它对齐。

### Scope

- Affects：仅 `src/main/devices/` 与 `src/main/emulator/index.ts` 的**文件组织**；新增 devices 域模块 10 个、emulator sdkIpc 系列 5 个；`book/docs/architecture/项目骨架.md` 快照同步。
- Does NOT affect：IPC 通道名与契约（`src/shared/ipc-channels.ts`、`src/shared/types.ts`、`src/preload/**` 全不动）；运行行为/错误文案/日志；renderer；emulator 其余 35 个域文件；`devices/__tests__/index.test.ts` 断言（保留为域级集成测试）；四个消费方（`ipc/index.ts`、`main/index.ts`、`emulator/sdkSourceSwitch.ts`、devices 测试）的 import 路径。
- Boundaries：纯机械搬移，不重构逻辑、不改函数签名语义、不顺手修发现的问题（记录到 issue）。

### Requirement

| 约束 | 要求 |
| --- | --- |
| 公共契约 | devices/index.ts 继续从同一路径导出全部 17 个符号；emulator/index.ts 继续导出 `registerSdkIpc / onSdkSourceChanged / defaultAvdHome` |
| 单例语义 | `vi.resetModules()` + `import('..')` 的重载语义保持——全部子模块经 `..` 依赖图加载，reset 后整图重载 |
| 验证门 | 每步 `npm run typecheck && npm run lint && npm test` 全绿才进下一步，每步独立 commit |

## Design — Phase 2

### devices/ 目标结构（分层 DAG：environment/state → persistence → scan/startup/lifecycle/create/edit → queries/ipc → index）

| 文件 | 约行数 | 内容（原 index.ts 行号区间） |
| --- | --- | --- |
| index.ts | 40 | 纯 re-export 17 个公共符号 |
| environment.ts | 150 | G2+G3（108-216）：ADVICE_RE、skinDirectoryFor、sdkRoot/avdHome/avdDirs/reconcileDirs、normalizeName、isCreateDeviceInput/isRenameInput/isDeviceIdInput、requireAdb（adbExecutable 私有 let）、messageOf、adbBinaryPath、androidToolEnv、ports、frameIndex 懒缓存 |
| state.ts | 200 | 跨组共享可变状态 + setter + 状态邻近助手：devices/revision/acceptingCommands/storeHealth/acceptedMetas/suspectIds/metaRevision/avdEpoch/lastReport/acknowledgedSignature（setter 组）、editFlights/frozenMessages/streamBridge（const Map/对象直接导出）+ bumpAvdEpoch、transientIdsNow、checkingAvailability、rebuildDevices、toMeta、snapshotNow、broadcastChanged、requireDevice、attachDeviceStreamBridge |
| persistence.ts | 380 | G6+G8+提交原语（362-817 减快照广播）：ensureLoaded（loadPromise 私有）、loadAndScan、runTransactionRecovery、applyFrozenTargets、deepEqual/metasEqual、rereadStore、enqueueStoreTask（writeQueue 私有）、rebuildWithPendingRows、commitMetas、pendingJournalCleanup + cleanupCommittedJournal、commitMetasWithConfig、assertMetaWritable、assertDeviceInCurrentBucket |
| scan.ts | 210 | G7（419-621）+ triggerSourceChangeReconcile + acknowledgeReconciliation：scanCurrent、changeKey、applyScan、syncReportRevision、refreshReportFromDevices、buildReport、collectDeviceIssues、computeSignature、reconciliationSummaryNow、reconcileDevices（reconcilePromise 私有）、performReconcile |
| startup.ts | 360 | G10+G11+G12（859-1207）：handleRunning、handleUnexpectedExit、emitRuntimeError、StartBlockedError、verifyWebcamsFor、withDeadline、checkTimeoutAvailability、displayArgsByDevice、arbitrationSideOf、startedBefore、enumerateWebcamLabels、cameraOverridesByDevice、applyCameraFallbackOverride、assertSdkDomainOpen、runner（createRunner 装配整体搬移） |
| lifecycle.ts | 330 | G13：startDevice、stopDevice、verifySnapshotSaved、cancelStartDevice、deleteFlow、deleteDevice（deleteFlights 私有）、purgeAppOwnedDevices、prepareAppShutdown、resumeAfterShutdown |
| create.ts | 230 | G14：createDevice、createDeviceTransaction、renameDevice |
| edit.ts | 640 | G15 减 commitMetasWithConfig：assertEditorTarget、editSaveBlockedReason、parseLegacyCamera、EditDraft、buildEditDraft、buildEditCapabilities、augmentDraftWebcams、sharedCameraOwnersOf、readDeviceConfig、isUpdateDeviceInput、verifyEditableCameras、updateConfigFlow、updateDeviceConfig |
| queries.ts | 120 | G5+G9：savedDeviceSkinRef、runningDeviceRef、isRunningDevice、listDeviceNamesReferencing、listDeviceRuntimeViews、runningDeviceSerial、runningDeviceCount、appOwnedDeviceCount |
| ipc.ts | 200 | G16：requireSender + registerDevicesIpc（13 handler 纯转发） |

可重赋值状态归属规则：单写方持有的 let 留在持有者文件；跨组读写的进 state.ts 配 setter（约 13 个）。

### emulator/ 目标结构

| 文件 | 约行数 | 内容 |
| --- | --- | --- |
| index.ts | 60 | registerSdkIpc 装配（调 4 个子注册）+ re-export onSdkSourceChanged/defaultAvdHome |
| sdkIpcShared.ts | 170 | resolveRoot、pushToAllWindows/pushProgress、confirmLicenses、toSkinSummary、requireWizardSender/requireSettingsSender、assertSdkWritable、readSourceTargetInput、requireSdkReady、SdkIpcDeps 类型、profilesCached、imagesCache/downloading/skinsCache/skinDownloading 状态与函数式访问器 |
| sdkIpcSource.ts | 110 | sdkStatus + 来源域 9 handler + sdkAppOwnedCount + sdkChooseCustomRoot + sdkBootstrap |
| sdkIpcCatalog.ts | 110 | sdkProfiles、sdkImages、sdkWizardCapabilities |
| sdkIpcSkins.ts | 140 | sdkDeviceSkinPresentation、sdkCameraAccess/Settings、sdkDeviceSkins、wizardChooseDeviceSkin、sdkDownloadDeviceSkin |
| sdkIpcImages.ts | 210 | sdkUninstallImage、sdkDownloadImage、sdkCancelDownloadImage |

### 实施顺序

每步独立 commit，typecheck + lint + vitest 全绿门禁：D1 environment → D2 state → D3 persistence → D4 scan → D5 startup → D6 lifecycle → D7 create → D8 edit → D9 queries+ipc+index 收薄 → E1 shared → E2 四分组 → E3 emulator index 收薄。

### 风险

- ESM `let` 导出不可外部赋值 → setter 方案，改动集中在 D2，3359 行测试兜底。
- runner 装配闭包引用面广 → startup.ts 整体搬移不拆内部。
- 环引用 → 上述 DAG；编译器即时暴露；禁止经 index 中转。
