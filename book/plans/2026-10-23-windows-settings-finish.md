---
description: 设置页 Windows 收尾——杀软白名单性能建议卡片（确切路径清单 + Defender 受控深链）、SDK 根路径过长检测提示（260 预算，只提示不拦截）、非 mac 板头去标题消除双标题；Win P6，依赖外围调研 C2/B3/E1
status: completed
created: 2026-10-23
---

# Windows 设置页收尾 — plan

> 实现记录（2026-10-23，feature/windows-settings-finish，基 feat/windows-branch fedc1a0）：按 Build order 四批全部完成。windowsPath 预算单源（260 − 1 − 100 = 159）+ 快照 avdHome（`avdHomePath()` 单源，零新 IPC）+ Defender 受控深链（`shell:open-windows-defender`，P5 通道同款）+ PaneEmulator 卡片与警示（`activeRootOf` 抽取，单选行路径展示复用；卡片内路径行局部放开 `user-select: text`）+ BoardHead 非 mac 去标题（`.title` 样式随删）。**声明的三处必要触碰全部兑现**：PaneEmulator.test 夹具补 `avdHome` 行、api 桩补 `platform: 'darwin'`（learn 2026-10-22-window-api-default-stub-injected-tests 先例）、BoardHead 非 mac 用例按新规格改写为「不渲染」；另有一处助手级触碰——dialog 测试的 `withPlatform` 从 P5 describe 内提升到模块级供两深链通道共用（P5 断言零改动）。1403 测试过（新增 10：windowsPath 3 / dialog 2 / sdkSource 1 / PaneEmulator 4）、typecheck/lint 0 错；mac 侧除上述声明触碰外既有断言零改动。真机项（深链真实拉起、排除生效提速体感、超长根实测核数）归统一集成验证。
> 依据：[外围调研](../notes/think-report/20261022110137-Windows兼容问题解决方案调研.md) §4（C2 Defender 排除引导）、§3（B3 长路径一期「检测 + 提示」）、§6（E1 双标题保守去重）。任务清单见 [todos](../todos/windows-support.md) P6。
> 依赖现状：P1–P5 已全部合并进 feat/windows-branch，可直接复用的先例：固定 URI 受控深链通道（`shellOpenWindowsFeatures`，`src/main/dialog/index.ts:76-81`）、渲染层平台读取（`window.api.platform`，P5 在 SettingsForm 的先例）、avdHome 叶子单源（`avdHomePath()`，`src/main/emulator/avdHomePath.ts:8`，零依赖任何层可引）。

## Requirements brief

- 作用域：① 杀软白名单性能建议卡片——设置窗「模拟器」页 win32 专属卡片：说明杀软实时扫描会拖慢镜像下载/解压与模拟器冷启动，列出建议加入排除的两个**确切路径**（当前活动 SDK 根 + avdHome），按钮经固定 URI 受控深链打开 Windows 安全中心（`ms-settings:windowsdefender`），第三方杀软（火绒/360）给通用指引一句；② SDK 路径过长提示——win32 且活动 SDK 根按保守预算估算将触 Windows 260 字符上限时，在「模拟器」页出警示卡（含当前长度数字，引导换更短路径；只提示不拦截）；③ 双标题去重——主窗板头非 darwin 分支不再渲染应用名标题（系统标题栏已承担同一信息），darwin 三灯让位分支不动。
- 排除项：`Add-MpPreference` 一键添加排除（不做——要经 UAC 提权执行外部命令，注入面与「绝不静默提权」纪律相悖；调研 C2 适配点本就只含卡片 + 深链，手动添加已够用）；longPathAware 清单注入（调研 B3 明确缓行，挂打包阶段再说）；PaneAbout 数据目录接线（`model.about.dataDirectory` 恒 null 的禁用占位是既有独立缺口，不顺手修）；`titleBarOverlay` 统一窗体（E2，todos 备注暂不排期）；路径长度进切换判定矩阵（一期只提示不拦截，B3 口径）；五个子窗（settings/wizard/report/wireless/logcat）本无应用内标题，零改动。
- 边界：全部为 win32 条件分支或纯展示层改动；darwin 行为零变化（卡片与警示 win32-gated、深链通道非 win32 拒绝、板头 darwin 分支逐字节不动）；SDK 来源切换/迁移主流程零改动（快照只增字段不改语义）。
- 验收要求：win32 卡片/警示/深链分支单测覆盖；mac 全套既有用例除三处声明的必要触碰（见风险 ②③，含测试桩）外零改动；`npm test` + typecheck/lint 0 错为门禁；真机项（深链真实拉起、排除生效的提速体感、超长路径实测核数）归统一集成验证。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/shared/windowsPath.ts`（新增） | 常量 `WINDOWS_MAX_PATH = 260`（微软含 NUL 口径）、`WINDOWS_SDK_SUBTREE_BUDGET = 100`（SDK 根下最深已知写入串的保守上界，推导见设计 3）与纯函数 `windowsSdkRootTooLong(root: string): boolean`（`root.length > 260 - 1 - 100`） |
| `src/shared/types.ts` | `SdkSourceSnapshot`（`:597-609`）增 `avdHome: string` |
| `src/main/emulator/sdkSource.ts` | `getSdkSourceSnapshot`（`:152-161`）返回值补 `avdHome: avdHomePath()`；`:141` 保留根清册里的局部 join 不动（不顺手重构） |
| `src/shared/ipc-channels.ts` | 增 `shellOpenWindowsDefender: 'shell:open-windows-defender'`（紧邻 `:166` 的 P5 通道） |
| `src/main/dialog/index.ts` | 该通道 handler：完全复刻 `shellOpenWindowsFeatures`（`:76-81`）形态——仅 win32、固定 URI `ms-settings:windowsdefender`、无 renderer 入参，非 win32 抛错拒绝 |
| `src/preload/api/dialog.ts` | 暴露 `openWindowsDefender()` |
| `src/renderer/src/components/settings/PaneEmulator.tsx` | 活动根三元链（`:191-202`）抽同文件局部小函数 `activeRootOf(mode, snapshot)`（返回可空原始值，map 内 activePath 展示复用且保留各自文案兜底，抽值不改行为）；win32 且 snapshot 在场时在 avdHint（`:269`）后渲染性能建议卡片与超长警示卡 |
| `src/shared/i18n/settings.ts` | 三语新键：`defenderTitle` / `defenderHint` / `defenderSdkRoot` / `defenderAvdHome` / `defenderOpen` / `defenderThirdParty`、`pathTooLongTitle` / `pathTooLongHint`（format 占位带当前长度） |
| `src/renderer/src/components/BoardHead.tsx` | `:24-28` 非 darwin 分支改渲染 null（双标题去重）；`.title` 样式规则（`:70-74`）随分支删除（死代码不留）；组件头注释同步 |
| `__tests__/` | windowsPath 纯函数；dialog 新通道（win32 放行 URI 固定 / 非 win32 拒绝）；sdkSource 快照含 avdHome；PaneEmulator 卡片与警示；BoardHead 非 mac 用例改写 |

风险：① 路径预算 100 是保守估计不是精确事实——预算偏松则真机仍可能撞 260。处置：常量单源 + 注释写明推导，真机集成阶段实测撞线即回填收紧（记 issue）。② 快照加字段 + 组件新读 `window.api.platform`，会让 PaneEmulator.test 的 `snapshotOf` 夹具（TS 报缺字段）与 `window.api` 桩（缺 `platform`，P5 的 learn：注入式用例缺 api 桩必崩）必须补——声明的必要触碰：夹具补一行 `avdHome`、桩补 `platform: 'darwin'`（win32 用例局部覆写、按钮用例另补 `dialog.openWindowsDefender`），既有断言零改动。③ BoardHead.test「非 macOS（%s）保留页面标题」用例（`:79-85`）按新规格改写为「不渲染」——规格变更在案，不是削弱断言。④ 精简版 Windows（LTSC 等）可能没有安全中心 app，深链打开无响应——一期不做 fallback，真机项覆盖后定。

## Design

1. **卡片数据从哪来（零新通道）**：活动 SDK 根复用 PaneEmulator 现有选择逻辑抽成 `activeRootOf(mode, snapshot)`（managed → `managedRoot`；shared → `sharedPath ?? detection?.sdkCandidate`；custom → `customPath`，均可空）——map 内 activePath 的文案兜底（`managedDirectory` / `notDetected` / `pathNotChosen`）留在渲染处，小函数只回原始值；AVD 路径走 `SdkSourceSnapshot` 新字段 `avdHome`——快照本来就是该版面的数据面（useSdkSource 直连），main 侧由叶子单源 `avdHomePath()` 供值，不为一个字符串开新 IPC。两行路径用版面既有 `.path` 样式；卡片内路径行局部放开 `user-select: text`（版面全局 none，`SettingsWindow.tsx:69`——卡片的目的就是让用户把路径誊进安全中心，不放开等于没给；只动卡片内两行，不做全局改动）。活动根为 null（共享未定位/自选未选）时该行按「未定位」占位、警示不评估。
2. **深链通道**：完全复刻 P5 `shellOpenWindowsFeatures` 的形态——固定 URI、仅 win32、无 renderer 入参、异常路径抛错拒绝。不共用 P5 通道（URI 语义不同，一通道一 URI 维持「无参可传」的不变量）。
3. **路径预算推导**：Windows MAX_PATH 260 含结尾 NUL，可用 259。SDK 根下最深已知写入串：`system-images\android-35\google_apis_playstore\x86_64\` ≈ 55 字符，加解包内层目录与最深文件层级 ≈ 45；下载临时名 `system-images\.system-images_android-35_google_apis_playstore_x86_64.downloading.zip` ≈ 85 也在界内 → 预算取 100，警示线 159。字符计数按 Windows 语义（分隔符各计 1），不做 realpath、不归一大小写。纯函数只做算术，win32 与否由调用方 gate（便于纯测）；托管根（`%APPDATA%` 下实测前缀 70-90）正常不触发，主要受众是自选深路径。
4. **警示呈现**：`action-card warn` 形态（与迁移横幅 `:274` 同款警示卡样式），静态建议不用 `role="alert"`（版面打开即在场，不是动态状态变化）；文案含当前长度数字（format 占位）；不带按钮——处置动作就在同页的 SDK 来源切换。
5. **卡片呈现**：`action-card` 普通形态（建议而非故障），标题 + 说明 + 两路径行 + 按钮 + 第三方指引一句；位置在 sdk-source fieldset 与 avdHint 之后；win32 且 snapshot 在场才渲染，加载中（snapshot null）不出。
6. **板头去重**：非 darwin 渲染 null，右端 `.head-right` 靠 `margin-left: auto` 原位不动；系统标题栏 `title: msg('windowTitle')`（`window/index.ts:32`）与 `page-title-updated` 防覆写（`:43`）不动——非 mac 的标题信息完全由系统标题栏承担，mac 三灯让位分支逐字节不变。
7. **mac 零回归**：卡片与警示由 `window.api.platform === 'win32'` gate（mac 恒不渲染）；深链通道 main 侧非 win32 拒绝（P5 同款）；快照新字段对 mac 是纯加法（消费端仅 win32 分支读取）；板头 darwin 分支不动；三语新键 mac 上无人引用。

## Build order

1. `windowsPath.ts` 纯函数 + 单测（边界：159 恰不警、160 警、空串不警、典型 `%APPDATA%` 托管根长度不警）。
2. 快照 `avdHome` 字段（types + sdkSource + PaneEmulator.test 夹具与 api 桩补齐）+ 深链通道（ipc-channels / main dialog / preload）+ 单测（dialog：win32 放行且 URI 固定、非 win32 抛错——P5 用例同构；sdkSource：快照含 `avdHome` 单源值）。
3. settings 三语新键 + `activeRootOf` 抽取 + PaneEmulator 卡片与警示渲染 + 单测（win32 渲染 / darwin 不渲染；两路径行取值随模式与 snapshot；警示随长度出现/消失且含数字；按钮点击调 `openWindowsDefender`）。
4. BoardHead 去标题 + 非 mac 用例改写；全套回归 + typecheck/lint/prettier；book 收尾（主会话统一）。

## Test plan

- 单测（windowsPath）：预算边界恰在阈值两侧（159/160）、常量与推导一致、空串安全。
- 单测（dialog / sdkSource）：新通道仅 win32 放行且 URI 固定 `ms-settings:windowsdefender`、非 win32 抛错（P5 用例同构）；快照返回含 `avdHome`（单源值）。
- 单测（PaneEmulator）：win32 + snapshot → 卡片出现、两路径行为活动根与 `avdHome`、按钮点击调用 api；darwin 桩 → 卡片与警示均不渲染；win32 + 160 字符根夹具 → 警示出现且含长度数字、短根不出现；共享/自选模式夹具下活动根跟随（自选深路径是主要受众）；既有断言零改动（除声明的夹具与桩）。
- 单测（BoardHead）：win32/linux 不渲染标题、按钮计数不变；darwin 既有用例零改动。
- 回归：全套既有用例（除声明的触碰）零改动；typecheck/lint/prettier。
- 真机（延后统一集成）：`ms-settings:windowsdefender` 真实拉起（含无安全中心的精简版场景）；两路径加入排除后下载/解压/冷启动的提速体感；超长自选根的实际字符数核数（撞线则回填预算常量并记 learn）。

## Done criteria

- 全套测试全绿；声明的必要触碰（PaneEmulator 夹具一行 + api 桩 `platform`、BoardHead 非 mac 用例改写）之外既有断言零改动；win32 卡片/警示/深链分支单测齐；三语新键落位；调研 §4 C2 适配点（卡片 + 深链 + 第三方指引）、§3 B3 一期口径（只检测提示不拦截）、§6 E1（板头去重）逐条对上；「不做」清单（Add-MpPreference / 清单注入 / PaneAbout 接线 / titleBarOverlay / 判定矩阵拦截）在 plan 与代码注释中口径一致；真机项明确归统一集成验证；book 收尾完成（主会话统一）。
