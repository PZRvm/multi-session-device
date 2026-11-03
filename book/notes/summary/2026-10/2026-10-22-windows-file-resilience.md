---
description: P4 文件链路健壮性落地——fsWin rename 容错（win32 锁重试+EXDEV 回退）接入三条链路、sha1 边下边算；零实现偏差，mac 构造性零回归
---

# Windows 文件链路健壮性（P4）功能报告

## 背景

Windows 上杀毒软件/索引器短暂打开文件句柄时，目录级 rename 会直接报 EPERM/EACCES/EBUSY（mac 不存在此形态），跨盘移动还会报 EXDEV。应用的镜像下载落位、SDK 引导归位、SDK 迁移三条链路里共有八处裸 rename 暴露在这个风险面下。另外镜像下载完成后要整文件重读一遍算 sha1——2GB 级包多付一次全量读盘。

## 做了什么

- 新增 `src/main/emulator/fsWin.ts`：`makeResilientRename(platform)` 工厂——win32 下对 EPERM/EACCES/EBUSY 以 100ms×10（约 1 秒，对齐 graceful-fs 窗口）退避重试、耗尽抛原错；EXDEV 回退 cp+rm（fs-extra 思路）。非 win32 恒返回裸 `fs.rename`。
- 三条链路接入：downloader 的 `moveDir` 默认实现（镜像落位/备份/回滚三处调用点）、sdk.ts 引导归位 4 处、sdkMigration 的 `renameEntry` 默认实现（journal 原子写/staging 归位/同卷移动/config.ini 共 4 处）——全部经既有接缝，调用方逻辑零改动。
- sha1 流式化：`DownloaderDeps.sha1Of`（下载后整文件回读）退役，换 `createHasher` 接缝，下载循环内增量喂入、`finish` 与取消检查点之后 digest 比对——校验位置、文案、失败清理全部保持。

## 为什么这么选

不引 graceful-fs/fs-extra 依赖：前者是全局 monkey-patch、后者整个库只用一个 move，借思路手写 40 行且可接缝注入单测，贴合仓库风格。重试集只包 rename：Node 的 fs.rm 对 EBUSY/EPERM 已内建线性退避重试，`removePath`/`rmTree` 全部零改动——这也是 `sdkSourceSwitch.ts` 零改动的原因（它没有直接 rename，移动全走 sdkMigration 接缝）。sdkMigration 已自带的跨卷「copy→校验→归位→删源」引擎不动，fsWin 只补锁重试与 st_dev 误判时的 EXDEV 兜底。mac 零回归是构造性保证：posix 分支就是 `fs.rename` 本身。

## 结果

全套 1370 测试通过（新增 fsWin 10 例、downloader 2 例）、typecheck 0 错、lint 0 问题；替换步骤完成时全量回归零行为变化。自查记录一条 P3 级观察：流式化后哈希反映的是流字节而非盘上字节（原整文件回读顺带做了落盘内容二次确认），极端的写路径静默丢数据改由后续解压与三件套核验兜底——如实接受并记录于 plan 实现记录。施工中一次全量跑出现 1 例未复现失败（连续两轮全绿，external 计时敏感域嫌疑最大），已记录、如再现立 issue。

## 后续

Windows 真机集成阶段验证三项：Defender 实时扫描期间 2GB 下载-归位的重试真实触发、跨盘（C:→D:）SDK 迁移与 EXDEV 兜底、第三方杀软（火绒/360）占用锁错误码采样回填 `RETRYABLE_CODES`。
