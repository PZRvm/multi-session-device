---
description: feat/windows-branch 三批合并集成 review——P1 引导/P2 检测链/P3 进程管理的接缝核查；无 P1，P2 一条（profiles.ts avdmanager 调用链 win32 必挂）+ P3 一条（四处 spawn 缺 windowsHide）；只记录不修
created: 2026-10-22
status: open
tags: [windows, code-review, merge, integration, p1-sdk-bootstrap, p2-studio-detect, p3-process-mgmt]
---

# feat/windows-branch 三批合并集成 review（P1 引导 18792dc + P2 检测链 99e0631 + P3 进程管理 b513ea8）

三批各自已过独立的 Phase 5 review 与修复批（P1 见 [sdk-bootstrap-review](2026-10-22-windows-sdk-bootstrap-review.md)、P2 见 [studio-detect-review](2026-10-22-windows-studio-detect-review.md)、P3 见 [process-mgmt-review](2026-10-22-windows-process-mgmt-review.md)）。本轮只审**合并接缝与相互作用**：三次合并共同触碰的文件、三条线在「平台判定 / spawn 约定 / 路径口径」上的收敛度、以及合并树上从未跑过的组合测试套件。按 workflow 只记录不修复。

## 合并结构事实

- 三批的源码文件群**完全不相交**（P1：sdk/downloader/avd/cameras/platformExec；P2：studioDetect/adb；P3：runner/quit-confirm/index）。两次 merge commit 对另一侧父的 diff 均为纯追加，无冲突消解痕迹。
- 唯一共改文件是 `src/shared/i18n/errors.ts`：P1 加 `sdkWindowsSourcePending`（插 SDK 域）、P3 加 `quitConfirm*` 四键（插退出域），插入位置不同域互不接触；三语包 5 键齐全，`ErrorsCopy = Record<keyof typeof zhCN, string>` 的类型约束兜底漏键。

## 已验证安全的接缝

- **platformExec（P1）与 runner（P3）平行不合并**：双向注记一致（`platformExec.ts:8-9`「runner 长驻进程平行自理」、`runner.ts:308-311` 引用同一约定），两条线各自 `deps.platform` 接缝、恒 `windowsHide: true`，无口径漂移。
- **P2 内部口径自洽**：`studioDetect.ts` 与 `adb.ts` 的 `LOCALAPPDATA`/`APPDATA` 都是 env 优先、缺省回退 homedir 拼接（P2 review P3-2 修复后对齐）；PATH 分隔符两处同写法 `isWin ? ';' : ':'`。
- **sdkPaths 单源落实**：cameras.ts:110（emulatorBin）、avd.ts:64（avdmanagerBin/jreHome）、sdk.ts 内部均走 `sdkPaths(root, platform)`，无旁路手拼（profiles.ts 除外——见发现 P2-1）。
- **退出流接缝**：`before-quit` 里 `confirmQuitIfNeeded` 位于 `quitPending = true` 之后、`prepareRecordingQuit` 之前；「留在应用」折返不触发录制/设备清理，`finally` 复位 `quitPending`（index.ts:70/109）；`browser-window-created` 挂的 `query-session-end`/`session-end` 对 mac 空挂无副作用。
- **sdkMigration 的 `diskutil` spawn（:83）**：win32 下 ENOENT 走 `error → resolveTo(null)` 优雅降级（fsTypeOf null = 不拦），不崩；其 adb 探测假阴性已有既有 [issue](2026-10-22-sdk-migration-adb-probe-win32.md) 在案，本轮不重复记。
- **合并树全量门禁**（该组合套件此前从未在 merge 后跑过）：typecheck 0 错、lint 0 问题、**1358 测试全过**（6 项既有跳过）、触碰文件 prettier 干净。

## 发现

### P2（应修，建议 Windows 真机集成前处理）

1. **`profiles.ts` 的 avdmanager 调用链在 win32 必挂——三处独立缺陷叠加，且全部漏在三份 plan 的影响范围外** — `src/main/emulator/profiles.ts`。
   - `avdmanagerPathFor`（:110-111）手拼 `join(sdkRoot,'cmdline-tools','latest','bin','avdmanager')`，win32 无 `.bat` 后缀——路径本身不存在（P1 后真身是 `avdmanager.bat`）。这是 sdkPaths 单源之外的第二个路径真源，与 P1 review「路径单源」决议直接冲突。
   - `defaultRunner`（:55）直接 `spawn(avdmanagerPath)`，不走 platformExec——即使路径改对成 `.bat`，Node 安全修复后直接 spawn `.bat` 抛 EINVAL。
   - `defaultRunner` 的 `javaHome`/`javaBin` 默认值（:43-44）写死 darwin 布局 `jre/Contents/Home/bin/java`，win32 的 sdkPaths 布局是 `jre/bin/java.exe`——前置的 X_OK 检查必失败，报 `profilesQueryFailed`。
   - 影响调用方：`sdkIpcShared.ts:81`（向导画像列表）、`devices/create.ts:100`、`devices/edit.ts:307`——Windows 上新建/编辑设备的画像列表必失败。
   - 根因：主体调研只识别了 `avd.ts:63-66` 的同款模式，profiles.ts 是漏网的兄弟调用点；P1 plan 影响范围未圈它。修法：`avdmanagerPathFor` 改走 `sdkPaths().avdmanagerBin`、javaHome/javaBin 默认值切 sdkPaths、spawn 换 `spawnCommand`；归 P4 前的独立小改批次。

### P3（可顺延，记录在案）

1. **四处 spawn 缺 `windowsHide`——win32 上每次调用闪 console 黑框**：`screenshot/index.ts:31`、`logcat/index.ts:194-197`、`scrcpy/proc.ts:13 与 :34`（`transport.ts:147` 经 `deps.spawn` 落到 spawnProc）。四处都是 spawn `adb.exe`（真 exe，无 `.bat` EINVAL 风险），属 UX 降级不属功能阻断——截屏、日志、投屏恰是 Windows 上最常用的交互路径。外围调研 A4 声称「全仓 spawn 调用点」但只枚举了 sdk/avd/runner/cameras/adb/downloader 六个文件，这四个站点漏在清单外，三份 plan 均未覆盖。修法：四处补 `windowsHide: true`（posix 无副作用），可与 P2-1 同批。

## 验证边界

- 证据为代码走读 + 合并树全门禁（typecheck/lint/1358 测试/prettier）；未起合并后应用的 GUI 实窗冒烟，Windows 真机行为（含 `.bat`/tar.exe/taskkill 真实执行）归统一集成验证阶段，与三份 plan 的既定边界一致。
- 三批各自 review 的留置项不变（P1 的 P2-1 cmd.exe 含空格路径、P2 的 P3-3/P3-4、P3 的 P3-1～P3-4），本轮不重复记。

## 结论

无阻断级问题：合并本身干净（文件群不相交 + errors.ts 异域插入），三条线的平台判定与 spawn 约定收敛一致，组合套件全绿。两条新发现都是「调研/plan 影响范围没圈到」的漏网调用点，不是分支间的代码重合或冲突；建议与既有 sdkMigration issue 同批，在 Windows 真机集成验证前修完。
