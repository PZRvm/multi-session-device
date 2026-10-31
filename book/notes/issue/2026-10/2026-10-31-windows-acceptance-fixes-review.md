---
description: Windows 真机验收十批修复（da14795..733e2b0）代码评审——0 P1 / 2 P2 / 8 P3；「删源前停 adb」族尚差 adopt 与 replaceTarget 清场两处，只记录未修
created: 2026-10-31
tags: [windows, review, acceptance, adb, migration]
---

# Windows 验收修复批 code review（2026-10-31）

范围：`da14795..733e2b0` 十个代码提交（钉版真值 / profiles 平台化 / second-instance / javaBinFor / classifyRoot / 迁移 adb 预检 + 跟踪器门 / 清保留根预检 / 共享引导按钮 / 分步图文指引 ×2）。评审代理独立取证（含钉版哈希经 GitHub API 与真实下载复核、本宿主实跑新用例）。

**结论：修复后可合并**——十批与三份 issue 的修法口径逐条对齐，darwin 逐字节等价在所有平台化站点成立，测试无弱化；「删源前停 adb」覆盖差两处 P2（窄触发、可恢复，非数据丢失）。

## P2（应修，建议随下一小批收口「删源 adb 预检」清单）

1. **`adoptSourceSwitch` 删落选根无 adb 预检**（sdkSourceSwitch.ts:415-417）——本批修法族的第三条删源路径漏网：`await deps.migration.rmTree(loserRoot)` 前什么都没停。可达：托管态跟踪器从托管根拉起 adb → 切到已有 SDK 的自选根走 needs-choice → 采纳 → EPERM。且失败落在 `setSdkSourceState`（:410-414，内存已翻）之后、`persistSdkSourceState`（:419）之前——内存/盘面分叉 + 半删目录。修法：与 clearRetainedRoot 同款（stopAdbServerInRoot + migration 钩子），补 darwin 钉时点用例。
2. **迁移 replaceTarget 目标清场在 adb kill 之前**（sdkMigration.ts:550-561）——顺序为 mkdirP → 清目标 rmTree 循环 → phase='moving' 落盘 → 才 stopSharedAdbServer；目标清场也是删源操作，钩子没盖住。可达：共享态旧 adb 存活于托管根，从共享迁回托管（replace）→ 清场撞活体 adb。修法：钩子上移到 `startMigration` 首次 `saveMigrationJournal`（:456）之后、进入 runJournal 前——保住「先置位再杀」时序又盖住清场与条目移动两段；用例在钩子体内断言 `targetCleared` 仍 false。

## P3（可顺延，记录在案）

3. `rollbackCorruptMigration`（:729-756）不调钩子——corrupt-journal 探测式回滚同样含 rmTree(from)，一行对称补齐。
4. `openSocket` 迁移门窄 TOCTOU（external.ts:328）——flag 检查后、ensureServer 的 spawn 落地前 journal 可能置位；毫秒级窗口、后果可恢复（journal 完好重试即过），与退避自愈并存，可不修。
5. 无线域 `runCmd`（external.ts:562）不经迁移门——adb 客户端命令会自动拉起 server，迁移中用户触发 wireless pair/connect 等价绕门；概率低，如修可让 wireless 入口读 migrationActive 拒绝。
6. `sdkSource` 初值 null 的竞态（DeviceWizard.tsx:150/184/697）——共享标志异步到达前必败按钮可能短暂出现（images 清单整体失败则停留）；主进程守卫兜底，可在 null 时也不渲染按钮。
7. `SharedSdkGuide` 是 `styled.ol` 但首子元素是 `<p>`（DeviceWizard.tsx:700-707）——ol 内容模型只许 li，invalid HTML（容错渲染无碍）；标题改 li 或提出 ol 外。
8. 指引文案 Windows 专属口径（wizard.ts:15-20：「Ctrl+Alt+S」「File > Settings」）——共享模式 darwin 同样可达，mac Studio 入口是 Preferences（Cmd+,）；三语均写死 win 键位。随下次 i18n 批补或注释标注「win 口径」。
9. darwin 零变化字面约束 vs 三处跨平台生效改动（kill 钩子非 win 也杀共享 adb ≤30s 重生、单实例锁改变 mac `open -n` 行为）——均有注释声明属有意取舍，建议 book 补记明示，防后续审计按字面打回。
10. 路径单源残余两站点：profiles.ts:46-49 重复 sdkPaths.javaBin 分支（输出等价）；startup.ts:273 `emulator` 无后缀字面量（win 下 Node CreateProcess 自动补 .exe 现可跑）——learn 自警的「第四站点」风险面，下次触碰时收编 sdkPaths。

## 核对过的安全点（评审实证）

- 钉版哈希真值：GitHub API digest 与真实下载实算双重复核一致，与 darwin 源同版本对齐。
- kill 时序：runJournal 先落盘翻 journalPresent 再停 adb、rollback 装载后停——与「先置位再杀」契约一致。
- 迁移崩溃恢复语义未被削弱（钩子只加 best-effort 前置，不触碰 journal 生命周期）。
- 测试无弱化：占位守卫用例改注入抛错 fetcher 属升级；profiles win32 夹具是真 cmd.exe 真解析边界；本宿主新用例全绿，153 失败逐一核对均为记档 posix 旧账。

## 修复批（2026-10-31 同日，用户拍板全量修）

P2-1/P2-2/P3-3 全部落地（钩子上移至 startMigration 落 journal 后盖住 replaceTarget 清场；adopt 前置停 adb；corrupt 回滚补钩；钩子用例升级为双调用 + 钩子内断言 isMigrationActive=true 的顺序契约）。P3-4（ensureServerDefault 二检收窄 TOCTOU）、P3-5（无线四入口迁移门）、P3-6（探测与渲染双闸对 null 也生效）、P3-7（根改 div、步骤独立 ol）、P3-8（第一步按平台出 Preferences/Cmd+, 文案，三语）、P3-10（profiles.javaBin 后缀与 startup.emulatorPath 收编 sdkPaths 单源）全部落地。另收口三件早期遗留：四处 spawn 补 windowsHide（闪黑框）、P5 review P3-3 后半（win32 verdict 注入直测）、**qemu 残留守卫**（orphan issue 候选 A 最小版：tasklist/pgrep 探测 seam，四个删源入口前置拒绝 + 三语新键 sdkEmulatorProcessAlive）、fsTypeOf 的 win 实现（Get-Volume，失败恒回 null 不误拦）。P3-9（darwin 张力补记）见 orphan issue 第五幕注记。

**仍开放**：P5 review P3-3 前半（sdkIpcImages 下载守卫 win32 传参直测）——需完整 IPC harness，超出本批合理范围，随下次触碰 sdkIpcImages 补。门禁：typecheck/lint 0 错；全套 155 失败中 153 为既有基线、另 2 例（DeviceWizard/SettingsWindow）单独复跑 54/54 全过属负载抖动；新增 11 用例全绿（探针 3、守卫 2、无线门 1、win32 verdict 1、mac 指引 1、corrupt 钩子 1 钉 darwin、及其它）。

## 处置

只记录未修（纪律）。P2×2 与 P3-3 建议并成「删源 adb 预检收口批」（五处清单：迁移正链/回滚/清保留根/adopt/corrupt 回滚），复用既有模式约几十行 + 用例；P3-7/8 随下次渲染/i18n 批；其余记录在案。
