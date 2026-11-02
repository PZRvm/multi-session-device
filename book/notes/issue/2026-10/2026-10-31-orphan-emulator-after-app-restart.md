---
description: 应用重启后上代 headless 模拟器进程存活成孤儿——runningCount 预检看不见，迁移与活体模拟器抢镜像文件（EPERM）；P3「孤儿进程」验收项的真机实证变体
created: 2026-10-31
tags: [windows, process, migration, acceptance]
---

# 应用重启遗留孤儿模拟器——文件域预检失明，迁移撞 EPERM

## 现象（2026-10-31 真机）

矩阵修复（5f5e0ca）后迁移正常启动：评估弹窗出现、逐条目搬移、journal 记账正确（cmdline-tools/emulator/jre/platform-tools 等全部 done）。搬 `system-images`（8.2G）时失败：`EPERM: rename '...\AndroidSDK\system-images' -> '...\androidsdk\system-images'`。占用者为存活的 `qemu-system-x86_64-headless`（2.9G 内存）——Windows 目录 rename 要求整棵子树零句柄，qemu 映射着 system.img。

## 根因链

1. **孤儿进程**：用户验收期间多次重启 `npm run dev`；上代应用启动的 headless 模拟器（无窗口、投屏走 scrcpy）在应用退出后存活。win32 spawn「不 detached」（P3）只影响控制台信号，不提供父死随亡（无 job object）——应用重启后 RunnerRegistry 清零，进程却还在。
2. **预检失明**：`startSourceMigration` 的 `runningCount` 读的是应用内 RunnerRegistry——重启后恒 0，放行迁移；迁移与活体模拟器竞争镜像文件。P4 的 fsWin 重试（EPERM/EACCES/EBUSY，10×100ms≈1s）只救瞬时锁（杀软扫描），对持续占用（活体进程）按设计放弃并抛原错——行为正确，重试窗口不该背锅。
3. journal 可重入设计正确接住中断：已搬条目不回滚、失败条目可续跑（实测清掉占用者后重试即恢复）。

## 影响

- 迁移/任何按目录 rename 的文件操作（含后续可能的卸载）与遗留模拟器竞争；headless 无窗口，用户对占用无感知，EPERM 报错也无从归因。
- darwin 同理存在（重启后孤儿 qemu + registry 清零），win32 只是先撞上。

## 修法方向（记录不修）

- 候选 A（收养）：应用启动时扫描遗留的 emulator/qemu 进程（按 sdk 根路径或命令行特征匹配），收养进 RunnerRegistry 或提示用户清理。
- 候选 B（预检加固）：文件域重操作前做进程级占用探测（openfiles/Restart Manager 成本高，慎入）。
- 倾向 A——与 P3 既有进程池抽象对齐；真机补验迁移前先确认无 qemu 存活。

## 验收期 workaround

迁移报 EPERM 时：任务管理器（或 `tasklist`）查 `qemu-system-*`，`taskkill /PID <pid> /T /F` 清树后回设置页重试迁移——journal 自动续跑，仅失败条目重试。本次实测：杀掉 PID 22040 树后无残留。

## 后续（同日第二幕）：adb 服务进程卡死回滚

清掉 qemu 后用户点「回滚」，回滚自身两处 EPERM：unlink `Desktopndroidsdk\platform-toolsdb.exe`（**正在运行的 exe 不可删除**——Windows 专属，POSIX 允许删除打开中的文件，故 mac 无此形态）与 rename `.migrating\platform-tools` → 源侧（两次半截回滚后目标已存在）。根因扩展：

- **adb 服务进程是第二个同族占用者**：外部设备跟踪器持续重连 adb server（控制台 `[external] track socket` 即其心跳），杀掉后秒级重生（实测 PID 23672 → 4972）——它跑着的 `adb.exe` 恰在待删目录里。
- **回滚恒走复制分支**：rollbackMigration 调 moveEntry 不传 `sameVolume`（缺省 false）→ copy+verify+rename+**rmTree(源)**——删除源与运行中二进制冲突；正向迁移（同卷 rename）反而安全（实测搬走运行中 adb 所在目录成功——Windows 允许改名运行中的 exe/其父目录）。
- 半截回滚两次后状态分叉：托管侧 platform-tools 完整（15 文件/17548054 字节与 journal 一致），Desktop 侧与 `.migrating` 各剩 3 文件残本。**手工修复**（2026-10-31）：杀 adb（重生不碍余下条目——新 adb 跑在托管侧 platform-tools，不属剩余回滚条目）→ 删两处残本 → journal 摘除 platform-tools 条目（其回滚实质已完成）→ 应用内续点回滚收尾其余 7 条目。

修法方向补充：迁移/回滚预检应先 `adb kill-server`（应用自管的 adb）并暂停外部跟踪重连，或迁移期间将 adb server 纳入生命周期管理；否则 win32 上任何删源操作都可能撞活体 adb。

## 第五幕（2026-10-31 review 收口批）：候选 A 最小版 + 删源预检全量收口

- **qemu 残留守卫落地**（候选 A 的预检版）：`emulatorProcessProbe.ts`（win32 tasklist 匹配 qemu-system / posix pgrep -f；失败按无残留放行——宁松勿误拦），`SwitchDeps.emulatorProcessAlive` 接缝，四个删源入口（startSourceMigration 含 resume、cancelSourceMigration、clearRetainedRoot、adoptSourceSwitch）前置拒绝 + 三语 `sdkEmulatorProcessAlive`。启动收养（完整候选 A）仍留待后续。
- **删源 adb 预检五处收口清单**（review P2-1/P2-2/P3-3）：迁移正链（startMigration 落 journal 后即停，盖 replaceTarget 清场）／回滚／corrupt 回滚／清保留根／采纳替换——「先置位再杀」顺序契约升级为测试事实。
- **无线四入口迁移门**（review P3-5）+ ensureServerDefault 二检（P3-4，收窄不消除）。
- **darwin 张力补记**（review P3-9，有意取舍非回归）：① kill 钩子非 win 平台同样执行——mac 上迁移期间共享 adb server 会被停 ≤30s 后自愈重生（外部真机跟踪短暂断开）；② 单实例锁未按平台 gate——mac `open -n` 强开第二实例从「完整运行」变「退出并唤回主窗」。两者均为跨平台行为，后续审计勿按「darwin 逐字节零变化」字面打回。
- **fsTypeOf win 实现收口**（matrix issue 遗留备注）：Get-Volume 查卷文件系统，FAT/exFAT 预检在 win32 重新生效；UNC/任何失败恒回 null 不误拦。

## 第六幕（2026-10-31）：应用内停止设备后 qemu 残留——守卫首次实战命中

用户真机流程：启动一台模拟器 → 应用内停止 → 迁移到自选路径 → 守卫正确拦截（提示残留模拟器进程）。实测 `tasklist` 确有 `qemu-system-x86_64-headless.exe`（725MB），且**父进程 emulator.exe 已死、qemu 子进程存活**——停止链的树杀未传导到 qemu（taskkill /T 应达整树；怀疑竞态窗口内 qemu 被 emulator 重新拉起后父 PID 链断裂，或某停止路径未走树杀）。手工 `taskkill /T /F` 清树后迁移放行。**这是 P3 验收项「停止后无孤儿 qemu」的真机实证缺陷**：根因定位（stop 链路哪个环节丢了树杀）归 P3 修复批；守卫的存在把该缺陷从「迁移神秘 EPERM」降级为「一条可操作提示」——正是设计意图。复测剧本：P3 进程剧本执行时，每次应用内停止设备后立即 `tasklist | findstr qemu` 核验。

**P3 剧本终检对照（同日）**：多开 2 台 → 关窗确认「留在应用」（应用驻留无窗、双模拟器与 5554-5557 全程在跑）→ 快捷方式二次启动唤回主窗（second-instance 修复真机实证 ✓）→ 再关窗确认退出 → 终检**零残留**：无 qemu/emulator 进程、5554-5557 全释放、adb 设备清空、应用进程退出。**关键对比**：确认退出的树杀链是干净的，残留只发生在「应用内停止单台」路径——根因方向收窄到 stop 链路（killGroup 对单设备的树杀），quit 链无罪。

## 第三幕（同日）：反复重试致 platform-tools 部分文件丢失与状态分叉

回滚收尾后用户另选新路径 `Desktop\sdk1` 重跑正向迁移（成功，sdk.json 翻 custom），再迁回托管时又于 platform-tools 失败并多次重试。终态盘点：7 个小组件已回托管；system-images（34 文件/8.2G）完好滞留 sdk1；**platform-tools 两侧各剩同一组 3 文件**（adb.exe + 两个 AdbWin dll），其余 12 个工具文件在失败的 rmTree 半途中被删——复制分支「先保目标再删源」的顺序在 rename(staging→to) 撞已存在目标失败时也会留下双残本。**手工修复（2026-10-31）**：关应用→杀 adb→清两处残本与空骨架→同盘 rename 把 system-images 移回托管→删 sdk1→sdk.json 回 managed→清 journal→`sdkmanager --install platform-tools`（r37.0.1，15 文件全量补回）。AVD config 为相对路径（`image.sysdir.1=system-images\...`）无需 relink。另证：**与 C 盘管理员权限无关**（AppData 为用户目录；全部失败均为进程占用/状态分叉）。

处置结论：来源切换在 win32 的故障路径已充分实证（矩阵失真已修、占用三连发已记档），UI 侧迁移/回滚在「adb 预检 + 起动收养」修复批落地前**不再重试**；验收第 7 项按「已验证到故障路径、修复归下一批」口径关闭。

> **修复批第二辑（2026-10-31 同日，用户拍板即修——adb 维度闭环）**：① `MigrationDeps` 增 `stopSharedAdbServer?` 钩子，引擎在 runJournal 的 journal 落盘后与 rollbackMigration 装载后、任何条目移动前调用（时序关键：先置位再停 server，倒置会被重连环在窗口期拉回）；② `createSwitchDeps` 注入默认实现——`runAdb(sdkPaths(resolveSdkRoot()).adbBin, ['kill-server'])` best-effort（失败/adb 缺席不阻断）；③ `external.ts` 的 `openSocket` 在 `ensureServer` 前加迁移门（`ExternalDeps.migrationActive?` 接缝，默认 `isMigrationActive`）——迁移在途不 `start-server`，只按退避续排，journal 清除后一拍内自行恢复（上限 MAX_BACKOFF_MS 30s）。测试：external 门控用例（假计时器，迁移中零 ensure、结束后恢复）双宿主绿；引擎钩子时点用例钉 darwin（引擎 resolve/join 宿主分隔符与 FakeFs 正斜杠键位不兼容，win 宿主属既有 15 例旧账），win32 真值由真机迁移链验证。typecheck/lint 0 错，定向与全套失败集与基线一致。**遗留**：qemu 孤儿收养（候选 A）仍未做——迁移前仍需用户自查无残留 qemu（workload：正常流程 runningCount 预检已覆盖应用内会话）。

> **修复批第三辑/第四幕（2026-10-31 同日）**：用户真机装 Studio 切共享模式（P2 检测链真装分支实证通过）后清保留根，`clearRetainedRoot` 的 rmTree 撞**从待删根内跑着的旧 adb.exe**（切共享是直接切换不走迁移链，第二辑预检盖不到）——EPERM 半删（根只剩 platform-tools）。修复：`clearRetainedRoot` 在 rmTree 前先 `stopAdbServerInRoot`（用待删根自己的 adbBin 发 kill-server——挡删除的 adb 恰在该根内、二进制必然在场；跟踪器随后从活动根重生、不同目录不再挡删除）+ 调一次 `deps.migration.stopSharedAdbServer?.()` 钩子（可注入断言）。新增时点用例钉 darwin（win 宿主属既有旧账）。typecheck/lint 0 错；定向 30 与全套 153 失败与基线逐数一致。
