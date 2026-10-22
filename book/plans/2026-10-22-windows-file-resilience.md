---
description: 文件链路 Windows 健壮性——rename/move 占用锁退避重试与 EXDEV 跨卷回退小工具（替换四个文件的裸调用点）、sha1 校验并入下载流省一次 2GB 读盘；Win P4，依赖外围调研 B1 与 P1 合并后代码现状
status: pending
created: 2026-10-22
---

# Windows 文件链路健壮性 — plan

> 依据：[外围调研](../notes/think-report/20261022110137-Windows兼容问题解决方案调研.md) §3（单元 B：B1 重试+回退选型；B1 补充事实——Node fs.rm 对 EBUSY/EMFILE/ENOTEMPTY/EPERM 已内建重试，工具只需覆盖 rename/move）与 §4.3/§4.5（sha1 流式化的挂靠口径：计划内工作、mac 同受益）；任务清单见 [todos](../todos/windows-support.md) P4。
> 与 P1 的依赖：[P1 SDK 引导平台化](2026-10-22-windows-sdk-bootstrap.md)已合并进 feat/windows-branch（[主体工程调研](../notes/think-report/20261022125639-Windows适配主体工程调研.md) 的落地）——downloader 落了 `makeExtractZip` 解压工厂、sdk.ts 落了 win32 归位分支，调研报告里的旧行号已漂移；本 plan 的 Impact range 按合并后现状逐行核对（2026-10-22，基 b513ea8）。P2（检测链，含 B2 大小写规范化）、P3（进程管理）亦已合并，与本 plan 无代码交叠。

## Requirements brief

- 作用域：① 新增 fs 层小工具——win32 下 rename/move 对 EPERM/EACCES/EBUSY 有界退避重试、对 EXDEV 回退 cp+rm（借鉴 graceful-fs 与 fs-extra 思路手写，零新依赖，接缝注入可单测），替换 `downloader.ts` / `sdk.ts` / `sdkMigration.ts` 里的裸 rename/moveDir 调用点；② sha1 校验并入下载流——`downloader.ts` 现为下载落盘后整文件重读算哈希（`sha1Of`），改为下载循环内增量 hash，省一次 2GB 级读盘（mac 同受益，计划内工作不是顺手修）。
- 排除项：长路径检测与提示（B3，归 P6）；`attrib +h` 隐藏临时文件（B4，调研定为可选不做）；检测链与路径大小写规范化（B2，已随 P2 落地 `studioDetect.ts:282-295`）；引入 graceful-fs / fs-extra 依赖（只借思路）；rm 的重试包装（fs.rm 内建重试已覆盖，见设计 6）；范围外其余 rename 调用点（`store.ts:470`、`theme/store.ts:75`、`locale/store.ts:67`、`recording/segments.ts:105`、`recording/preferences.ts:69`、`configTransaction.ts:38`、`sdkSource.ts:185`、`skinSource.ts:214`、`deviceConfig.ts:106`、`avd.ts:170`——同目录/同根的小文件 tmp+rename 原子写与皮肤目录归位，撞锁概率与影响面小于 SDK 目录级移动，真机验证后如需另行扩展，不在本 plan 批量替换）；真机杀软行为实测（统一集成阶段）。
- 边界：重试工具按平台分支——非 win32 恒返回裸 `fs.rename`（mac 逐字节同现状，构造性保证）；sha1 流式化平台无关，但可观测行为（进度序列、错误文案、产物、取消分流）逐项不变。
- 验收要求：fsWin 单测覆盖（失败序列注入、EXDEV 回退、posix 直通、退避节奏零真实等待）；除钉 `sha1Of` 接缝形态的用例（断言不变、仅注入方式改写）外既有用例零改动全绿；typecheck/lint 0 错；真机项（杀软锁真实触发、跨盘移动实测）显式标注延后统一集成阶段。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/main/emulator/fsWin.ts`（新增） | rename 容错工具 `makeResilientRename(platform, deps?)`：win32 下 EPERM/EACCES/EBUSY 退避重试（100ms×10 ≈ 1s 窗口）+ EXDEV 回退 cp+rm；非 win32 恒为裸 rename；renameFn/copyDir/removePath/sleep 接缝注入 |
| `src/main/emulator/downloader.ts` | ① `defaultDeps.moveDir`（`:135`，裸 rename）换 fsWin——`installImageZip` 的备份 `:433` / 落位 `:437` / 回滚恢复 `:451` 经接缝统一生效；② sha1 流式化：`DownloaderDeps.sha1Of`（`:49`、默认实现 `:115-122`）退役，换 `createHasher` 接缝，下载循环（`:234-252`）内 update、`finish` + 取消检查点（`:253-256`）后 digest 对比，校验块 `:263-274` 的位置与文案保持；`createReadStream` import（`:3`）清理 |
| `src/main/emulator/sdk.ts` | `bootstrapSdk` 归位 4 处裸 rename 换 fsWin：win32 JRE `:452`、darwin JRE `:455`、cmdline-tools `:477` / `:479`（P1 加了 win32 JRE 分支，现为 4 处——调研时描述 3 处） |
| `src/main/emulator/sdkMigration.ts` | `defaultDeps.renameEntry`（`:70`，裸 rename）换 fsWin——journal 原子写 `:168`、staging 归位 `:684`、同卷条目移动 `:689`、config.ini 原子写 `:790` 随接缝统一受益；迁移自身的跨卷 copy→校验→归位→删源引擎（`moveEntry` `:660-690`）不动 |
| `src/main/emulator/sdkSourceSwitch.ts` | **零改动**：当前代码无直接 rename/move 调用——迁移动作全经 `MigrationDeps`（由 sdkMigration 默认实现覆盖），仅有的两处 `rmTree`（`:405` / `:425`）已是 fs.rm（内建重试）。调研所述「sdkSourceSwitch 的裸 rename」在 P1 合并后的代码里经由 sdkMigration 落地 |
| `__tests__/`（emulator 域） | fsWin 新用例；`downloader.test.ts` 钉 sha1Of 形态的用例（`:143` 注入、`:174` / `:354` / `:397`）改写为 createHasher 注入——断言不变；其余全部零改动 |

风险：重试窗口（≈1s）内目标可能被第三方（杀软/用户）改动——重试以 rename 真实结果为准，不引入内容校验（迁移计划内跨卷已有文件数+字节校验，工具层不重复语义）。处置：EXDEV 回退非原子（cp 与 rm 之间崩溃留半拷贝或源残留）——但现有调用点的 rename 均为同根/同卷构造（downloader 的 `.unzipping` 与 destDir 同在 sdkRoot 下、sdk.ts 的 `.tmp-*` 同在 root 下、journal/config.ini 为同目录 tmp 替换），EXDEV 在正常路径不会出现，回退纯为 st_dev 误判等异常场景的兜底；兜底失败的清理由各调用点既有回滚路径兜底（downloader 落位事务回滚 `:443-467`、bootstrap finally 清 tmp `:457-459` / `:481-483`、migration journal 重入），工具层不额外清理（如实记录）。

## Design

1. **fsWin 工具形态**：`makeResilientRename(platform, deps?)` 工厂（对齐 P1 `makeExtractZip(platform)` 先例）返回 `(from, to) => Promise<void>`。win32：`renameFn` → catch 按 `error.code` 分流——EPERM/EACCES/EBUSY → `sleep(100ms)` 重试至多 10 次、耗尽抛原错；EXDEV → `copyDir(from, to)`（默认 `fs.cp(recursive)`，Electron 39 内置 Node 22+ 已稳定；force 覆盖语义与 rename 覆盖既有目标一致）成功后 `removePath(from)`（默认 `fs.rm(recursive, force)`），任一失败原样抛。**非 win32：直接返回 renameFn**——mac 零变化是构造性保证（posix 分支就是 `fs.rename` 本身），不依赖「重试恰好不触发」的论证。常量：`RETRYABLE_CODES = { EPERM, EACCES, EBUSY }`（graceful-fs 的 Windows 锁错误集，EBUSY 为杀软句柄常见形态）、`RETRY_INTERVAL_MS = 100`、`RETRY_MAX = 10`（≈1s，对齐 graceful-fs 重试窗口）。调研提到的 `renameWithRetry` / `moveDirWithFallback` 收敛为一个函数——重试集与 EXDEV 回退作用在同一条 rename 调用序列上（graceful-fs 管锁、fs-extra 管跨卷），拆两个导出是人为分层。不并入 `platformExec.ts`（那是子进程域，混域）；不加重试日志（三份目标文件现状零日志，真机阶段如需观测再加）。
2. **调用点替换清单**（全部经既有接缝或模块级常量，调用方逻辑零改动）：
   - `downloader.ts:135`：`defaultDeps.moveDir = makeResilientRename(process.platform)`——`installImageZip` 三处 `d.moveDir` 调用点不动，注入测试（makeEnv）不受影响；
   - `sdk.ts`：模块级 `const renameResilient = makeResilientRename(process.platform)`，`:452` / `:455` / `:477` / `:479` 四处 `rename` 换之——平台判定取真实 `process.platform` 而非 `deps.platform`（后者是布局/选源业务接缝，测试注入假平台；重试是 fs 层平台事实，生产环境两者恒一致）；
   - `sdkMigration.ts:70`：`renameEntry: makeResilientRename(process.platform)`——`MigrationDeps` 接缝与 FakeFs 注入测试全部不动。
3. **与迁移引擎的分工**：sdkMigration 计划内跨卷走自身 copy→校验→归位→删源（`moveEntry`），语义（逐条目 journal、崩溃重入、字节数复核）不动；fsWin 挂在其 `renameEntry` 默认实现上，只补两件事——win32 锁重试（staging 归位 `:684` 与同卷条目移动 `:689` 撞杀软句柄的容错），以及 st_dev 误判同卷时 rename 冒 EXDEV 的 cp+rm 兜底。兜底无逐字节校验：成功则条目照常记 done（如实接受，重试成功同样无校验）；失败则抛错、entry 未记 done，resume 按原 copy 路径重来，不虚报完整性。
4. **sha1 流式化**：删 `DownloaderDeps.sha1Of`，新增 `createHasher?: () => { update(chunk: Uint8Array): void; digest(): string }`（默认 `() => createHash('sha1')`）。`downloadImageZip` 仅在 `target.zipSha1 !== null` 时建 hasher（对齐现状：sha1Of 只在该条件下被调用），循环内对每个 chunk `hasher.update`（与 `received` 计数同步），`sink.finish()` + 既有取消检查点（`:256`）之后 `digest()` 与 manifest 比对——校验块位置、错误文案（`dlIntegrityFailed`）、失败清理、100% 推送时序全部保持。对调用方（`sdkIpcImages.ts:135`）可观测行为不变：进度 0-99 序列一致、校验失败仍先于落位抛错（只是从「重读数秒后」提前到「finish 后立即」）、取消分流（CancelledError / aborted AbortError）不变。
5. **mac 零回归论证**：① rename 工具——posix 分支即 `fs.rename`（设计 1），四个替换点在 darwin 下与替换前逐字节等价，既有用例零改动全绿即证；sdk.ts `:452` 是 win32 专属分支、darwin 不可达。② sha1 流式化——平台无关，mac 同受益（省一次 2GB 读盘，正是「计划内工作」口径：调研 §4.3 列为顺带受益、todos P4 明文「下载校验改成边下边算」）；行为面逐项不变，唯一变化是内部机制——钉旧机制的 sha1Of 注入用例按新接缝改写、断言不动。
6. **范围收敛（fs.rm 内建重试）**：Node 官方 fs.rm 对 EBUSY/EMFILE/ENOTEMPTY/EPERM 自带线性退避重试（调研 §3.3 补充事实）——`removePath`（`downloader.ts:136-138`）与 `rmTree`（`sdkMigration.ts:71`）全部零改动，本 plan 只包装 rename/move。这也是 `sdkSourceSwitch.ts` 零改动的根因：其删除动作（`:405` / `:425`）已是 fs.rm，移动动作在 sdkMigration 的接缝默认实现里。
7. **不做**：graceful-fs 式全局 monkey-patch（侵入性强，借思路不引包）；重试期内容校验；其余 rename 调用点的批量替换（见排除项）；fsWin 内新增 i18n 词条（错误原样上抛，由调用方既有文案域收口）。

## Build order

1. `fsWin.ts` + 单测（失败序列注入：第 n 次成功 / 耗尽抛原错 / 非重试码直抛；EXDEV cp+rm 调用序列与失败传播；posix renameFn 恰被调用一次直通；sleep 注入断言退避次数且零真实等待）。
2. 三个调用点替换（downloader `moveDir` 默认实现 / sdk.ts 四处 / sdkMigration `renameEntry` 默认实现）+ 全套回归——此步完成后应为零行为变化：既有用例全绿零改动（含 sdk win32 假源全流程与 FakeFs 迁移全量）。
3. sha1 流式化：接缝替换 + 循环内 update + digest 对比 + import 清理；`downloader.test.ts` 的 sha1Of 形态用例同步改写（断言不变）+ 新增 createHasher 用例（哈希不匹配 / 无 zipSha1 不建 hasher / finish 后 digest 前取消）。
4. 全套回归 + typecheck/lint/prettier + book 收尾。

## Test plan

- 单测（fsWin）：EPERM/EACCES/EBUSY 各自触发重试并恢复；ENOENT 等非重试码不重试直抛；重试耗尽抛原错；EXDEV → copyDir+removePath 顺序断言、copyDir 失败 / removePath 失败原样抛；posix 直通（renameFn 一次、错误原样）。
- 单测（downloader）：sha1 不符删临时 zip 并抛既有文案；进度序列与 100% 时序回归；取消三分支（流中 / finish 后 digest 前 / 解压后落位前）回归——后两者注入方式改 hasher / stream，断言不变。
- 回归：sdk（darwin 全流程 + win32 假源全流程）、sdkMigration（FakeFs 全量）、sdkSourceSwitch、emulator 域其余全部零改动全绿；typecheck/lint/prettier。
- 真机（延后到统一集成阶段）：Windows 上 Defender 实时扫描期间的 2GB 下载-校验-归位（重试是否真实触发、是否仍见偶发失败）；跨盘（C:→D:）SDK 迁移与 EXDEV 兜底实测；火绒 / 360 等第三方杀软占用锁的错误码形态采样（回填 `RETRYABLE_CODES` 是否需扩）。

## Done criteria

- 全套测试全绿；fsWin 单测齐；除 sha1 接缝形态用例（断言不变）外既有用例零改动；typecheck/lint 0 错；调研 §3 B1 落地路径（工具 + 调用点替换）与 §4.3 sha1 口径逐条对上，B2/B3/B4 的不做过界与 P2/P6 分工记录在案；`sdkSourceSwitch.ts` 零改动的核对结论随实现记录（learn 或 summary）；book 收尾完成。
