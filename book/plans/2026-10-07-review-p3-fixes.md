---
description: 修复皮肤/摄像头集成 review 的三项 P3——取消不再冒充失败、零背景皮肤入库口径统一、启动核验文案不再叠加建议从句
status: completed
created: 2026-10-07
---

# review P3 三项修复

## Brief 与设计

来源：[review 发现](../notes/issue/2026-10/2026-10-07-skin-camera-code-review-findings.md)三项 P3，用户批准全部修复。范围限定这三项；GPU 卡顿排查、buildPackageXml、真机验收等边界留项不属本轮。

1. **取消哨兵**：`wizardChooseDeviceSkin` 取消选择器、`sdkDownloadDeviceSkin` 同意框取消，从 throw 改为返回 `null`（IPC 契约 `DeviceSkinSummary | null`）；renderer 收到 null 静默早退（不 reload、不置 skinError），真实失败仍走 catch 呈现。
2. **零背景口径**：`renderableArtFiles(layout)` 作为可渲染素材清单单一来源（两方向 backgrounds + foregroundMask 去重），`skinPresentation` 改用它；`importSkinArchive` 零清单拒绝入库、`scanSdkSkins`/`scanImportedSkins` 跳过、`skinSource.acquireSkin` 核验同口径。
3. **核验文案**：启动前摄像头枚举失败的消息，底层错误已含建议从句（如「请检查 emulator 版本」）时不再追加「请检查权限或改用模拟画面」，只有裸错误才补建议。

不影响：皮肤下载互斥三层、手选保留、能力构建路径、AVD/皮肤资源本身；不改变「枚举失败不静默启动」的决定。

## 验证与收尾

测试先行：取消不弹 alert（下载与导入两路）、零背景 zip 导入被拒、扫描跳过零背景条目、devices 域启动核验两种文案分支 + 缺摄像头透传回归。全量 typecheck/lint/测试后，issue 记录补已修跟进、本 plan 翻 completed、刷新索引。

## 结果（2026-10-07）

六条失败测试先复现（取消 resolve null 炸进 catch、零素材条目入库、建议从句叠加），随后按设计实施。取消哨兵：两处 IPC 契约改 `DeviceSkinSummary | null`，renderer 静默早退且不 absorb/不解锁；零背景口径：`renderableArtFiles` 单一来源被 presentation/导入/SDK 扫描/库扫描/官方下载五处共用；核验文案按底层错误是否含建议从句分支，devices 域首次补 cameras mock 的核验回归（此前启动核验无单测）。

全量 406 通过（+8 新测试）、5 项既有跳过；typecheck 0 错、lint 0 错 0 警、electron-vite 构建通过。issue 三项已附「已修」跟进，learn 记取消契约与错误包装两条经验。GPU 卡顿排查、buildPackageXml、真机验收等边界留项维持原状。
