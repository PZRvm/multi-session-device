---
description: 模拟器环境适配——镜像目录按宿主架构过滤 x86_64、WHPX 缺失的失败识别与深链引导、摄像头空列表的系统隐私设置入口；Win P5，依赖外围调研 D1-D3
status: completed
created: 2026-10-22
---

# Windows 模拟器环境适配 — plan

> 实现记录（2026-10-22，feature/windows-emulator-env，基 feat/windows-branch 66ebb1c）：按 Build order 三批全部完成。ABI 单源（`hostImageAbi` + `hostAbi` 可选参数，缺省即现状）+ catalog 双路径过滤（`platform` 接缝）+ 三处 arm64 硬编码 gate 全部改走单源；`whpx.ts` 匹配器（官方致命句式 + 组合特征，宽匹配明确排除）+ devices 层 `whpx-missing` 收口 + 受控深链通道与 DeviceRow 按钮；摄像头深链/空列表文案单源 + SettingsForm 按钮条件扩展。**两处实现偏差**：① `SettingsForm` 新建 `wizard/__tests__/` 独立测试目录直测纯展示组件（此前无测试先例）；② `DeviceWizard.test` 补 beforeEach 默认 `{ platform: 'darwin' }` 桩——组件新增 `window.api.platform` 读取后注入式用例缺 api 桩必崩（learn 2026-10-22-window-api-default-stub-injected-tests），既有断言零改动。调试副产物：lifecycle 用例的 win32 平台覆写初期罩住了创建步骤，arm64 设备被 ABI 守卫正确拦截——恰是过滤链生效的实证，覆写改为只罩收口时刻。1379 测试过（新增 21）、typecheck/lint 0 错、mac 侧既有断言零改动。风险 ② 已按承诺记 issue（2026-10-22-win32-hidden-non-x86-images）；真机项（WHPX 真实样本采样回填、深链拉起、x86_64 全链）归统一集成验证阶段。
review 修复轮（2026-10-22，发现见 issue 2026-10-22-windows-emulator-env-review）：P2-1 已修——whpxMissing 繁中功能显示名改为系统实际文案「Windows Hypervisor 平台」（简中/英文本就正确）；P3-1～P3-3 顺延（前两条裁决点在真机集成验证）。1379 测试全绿、typecheck/lint 0 错。

> 依据：[外围调研](../notes/think-report/20261022110137-Windows兼容问题解决方案调研.md) §5（调研单元 D：D1 WHPX / D2 ABI 过滤 / D3 摄像头深链）与 §8 假设批复（Win10 1809+ / x86_64）。任务清单见 [todos](../todos/windows-support.md) P5。
> 依赖现状：P1/P2/P3 已合并进 feat/windows-branch——runner 现状已含平台接缝（`RunnerDeps.platform`/`killTree`，`runner.ts:70-73`），catalog/skins/cameras 的 spawn 已统一 `windowsHide`（P1/P3）。本 plan 不动 runner 本体，只消费它的失败收口产物。

## Requirements brief

- 作用域：① 镜像目录按宿主架构过滤——win32 下 `catalog.ts` 的 manifest 查询与本地扫描合并结果只列 x86_64，配套把三处 arm64 硬编码（compatibility 判定 `compatibility.ts:51`、下载守卫 `sdkIpcImages.ts:113`、创建守卫经 `create.ts:108` 调前者）改为按宿主 ABI 单源判定，`errors.ts` 的 `compatCrossArch` 文案（现只写 macOS Apple Silicon 场景）补 Windows 措辞；② WHPX 缺失识别——emulator 启动失败收口时识别「Windows 虚拟化未开启」特征输出，改写 `lastError` 语义并给出深链引导（`ms-settings:windows-optionalfeatures` 打开「Windows 功能」）；③ 摄像头空列表深链——`sdkIpcSkins.ts:75` 的「去系统开权限」补 win32 分支（`ms-settings:privacy-webcam`），win32 下列表为空时提示口径指向 Windows 隐私设置并显示该入口按钮。
- 排除项：WHPX 开启状态的主动探测（不做——只做失败后的被动识别引导；主动探测要 WinRT/系统命令探针，失败场景已被启动收口覆盖，收益不成比例）；`cameras.ts` 权限探测口径改动（不做——win32 维持 `granted`/`true` 现状 `cameras.ts:68-74`，Windows 对桌面应用的相机总开关没有 Electron 可查的 API，`-webcam-list` 空列表即事实，只补引导入口）；托盘与 UI 窗体（P6/backlog）；emulator console 优雅退出（backlog A2）；`preferredAbi` 字段开放（恒禁用、Optimal 即解析为选中包 ABI，平台无关，不动，`settings.ts:179`）。
- 边界：全部 win32 条件分支或纯数据/文案层改动；darwin 的目录不过滤（照列全 ABI、仅 arm64 判 supported）、深链字符串逐字节不变、权限探测不动；runner 与 P3 接缝零改动。
- 验收要求：win32 过滤/识别/深链分支单测覆盖；mac 全套既有用例零改动全绿；`npm test` + typecheck/lint 0 错为门禁；真机项（WHPX 真实错误样本采样等）标注延后统一集成验证。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/shared/compatibility.ts` | 新增导出 `hostImageAbi(platform)`（win32 → `x86_64`，其余 → `arm64-v8a`）；`assessImageCompatibility` / `profileHasSupportedImage` 增可选参数 `hostAbi`（缺省 `'arm64-v8a'`，`compatibility.ts:51` 的硬编码比较改用它） |
| `src/main/emulator/catalog.ts` | `ImageCatalogDeps`（`:543`）增 `platform?: NodeJS.Platform` 接缝；`fetchImageCatalog`（`:575`）在两条返回路径（localOnly `:582-589` / 全量 `:624-625`）的 `mergeCatalog` 之后按宿主 ABI 过滤（仅 win32 生效） |
| `src/main/emulator/sdkIpcImages.ts` | 下载守卫 `:113` 的 `entry.abi !== 'arm64-v8a'` → `entry.abi !== hostImageAbi(process.platform)`（win32 放行 x86_64、拦 arm64；mac 语义不变） |
| `src/main/devices/create.ts` | `:108` 的 `assessImageCompatibility` 调用传入 `hostImageAbi(process.platform)` |
| `src/renderer/src/components/DeviceWizard.tsx` | `:493` 逐镜像 verdict 与 `:507` `profileHasSupportedImage` 传入 `hostImageAbi(window.api.platform)`（shared 纯函数在 renderer 拿不到 `process.platform`，由调用方注入，`preload/api/index.ts:17` 已暴露） |
| `src/main/emulator/whpx.ts`（新增） | 纯文本匹配器 `looksLikeWhpxMissing({ stderrTail, stdoutTail })` + 模式常量导出（供单测与真机样本回填） |
| `src/main/devices/startup.ts` | `handleUnexpectedExit`（`:58`）头部挂 win32 分支：命中匹配器 → `lastError = { code: 'whpx-missing', message: msg('whpxMissing', { detail }) }`，`emitRuntimeError` 同步该 code；未命中走既有 `'unexpected-exit'` 收口（`:72`） |
| `src/shared/ipc-channels.ts` | 新增受控 shell 通道 `shellOpenWindowsFeatures: 'shell:open-windows-features'` |
| `src/main/dialog/index.ts` | 该通道 handler（紧邻 `shellShowItemInFolder` `:48-71` 的受控 shell 先例）：仅 win32，固定 URI `ms-settings:windows-optionalfeatures`，无 renderer 入参 |
| `src/preload/api/dialog.ts` | 暴露 `openWindowsFeatures()` |
| `src/renderer/src/components/DeviceRow.tsx` | `lastError.code === 'whpx-missing'` 时在 error-line（`:204-207`）旁渲染「去开启 Windows 虚拟化」按钮 → `window.api.dialog.openWindowsFeatures()`；其他 code 无按钮 |
| `src/main/emulator/sdkIpcSkins.ts` | `sdkCameraSettings`（`:73-79`）改用 `cameras.ts` 的 URL 单源：darwin 分支字符串不变，补 win32 → `ms-settings:privacy-webcam` |
| `src/main/emulator/cameras.ts` | 新增纯函数 `cameraSettingsUrlFor(platform)`（darwin/win32/其余 null）与 `cameraListEmptyMessage(permission, platform)`；`readCameraSnapshot`（`:83-103`）空列表时的错误文案改经后者（win32+granted → 新键 `cameraNoneFoundWindows`；darwin 文案原文不动）。权限探测函数 `:68-82` 零改动 |
| `src/renderer/src/components/wizard/SettingsForm.tsx` | 「打开摄像头权限设置」按钮（`:278-287`）渲染条件扩为：`['denied','restricted']` 含当前 permission（mac 现状）**或** `window.api.platform === 'win32' && capabilities.webcamDeviceIds.length === 0` |
| `src/shared/i18n/errors.ts` | `compatCrossArch`（`:441`/`:901`/`:1409` 三语）补 Windows 措辞；新增 `whpxMissing`、`cameraNoneFoundWindows` 三语。`crossArchDownloadUnsupported`（`:238` 等）措辞本就平台无关，不动 |
| `src/shared/i18n/mainWindow.ts` | DeviceRow 按钮文案 `openWindowsFeatures` 三语 |
| `__tests__/` | catalog（过滤）、compatibility（hostAbi 参数）、whpx（新）、startup（收口 wiring）、cameras（纯函数）、DeviceListPane（按钮渲染/点击）用例 |

风险：① WHPX 匹配误报（emulator 非致命日志里也可能出现 `WHPX` 字样）。处置：匹配器只在**失败收口**（进程已死/boot 失败）时被调用且仅 win32，模式锚定高信号整句而非单词（见设计 3），完整样本清单归真机采样回填。② win32 过滤后本地已有的非 x86_64 镜像（仅限手工从 mac 拷来的 SDK 场景）不再列出，卸载入口随之不可见。处置：一期接受（场景罕见、x86_64 API 21+ 全覆盖），记录于 issue 供后续加「不可用已装镜像」提示。③ 32 位 x86 镜像一并隐藏——范围内决策（调研 D2：x86_64 全覆盖，不做双 ABI 放行）。

## Design

1. **宿主 ABI 单源与目录过滤的数据流**：ABI 政策单源落 `shared/compatibility.ts` 的 `hostImageAbi(platform)`（win32 → `x86_64`，其余含未知平台 → `arm64-v8a`，非 win32 默认值即现状）。目录过滤注入点在 `fetchImageCatalog` 的 `mergeCatalog` **之后**（两条路径各一处）：远端 manifest 条目与本地独有条目在此汇成一份清单，单点过滤同时覆盖「manifest 查询」与「本地扫描」两个来源；`scanLocalImages` 本体不过滤——它是磁盘事实扫描器，政策留在目录装配与兼容性判定两道口（创建侧 `create.ts:108` 的兼容性守卫对 arm64 镜像仍会拦下，双保险）。清单缓存（`cacheImages`）存的是过滤后结果，无需另动。
2. **平台接缝怎么进来**：catalog 复用既有 deps 注入体系扩展一个 `platform?: NodeJS.Platform`（与 P1 `PlatformExecDeps.platform`、P3 `RunnerDeps.platform` 同一模式，`ImageCatalogDeps` 本就是该文件的接缝层）——不建新接缝模块。shared 的 `assessImageCompatibility` 是主/渲染两进程共用的纯函数，走**显式参数**而非 deps：renderer 侧由调用方传 `hostImageAbi(window.api.platform)`（sandbox 渲染进程读不到 `process.platform`），main 侧传 `hostImageAbi(process.platform)`；缺省值钉 `'arm64-v8a'`，所有未改调用点（含全部既有测试）行为逐字节不变。
3. **WHPX 识别的挂点与样本来源**：匹配器是 emulator 输出知识的纯函数，放 `emulator/whpx.ts`（与 `parseWebcamList` 同类）；**分类挂在 devices 层** `startup.ts` 的 `handleUnexpectedExit`——理由：runner 的 `UnexpectedExitInfo`（`runner.ts:33-38`）是原始进程事实（退出码 + 双 tail），其唯一消费端就是 `handleUnexpectedExit`（`startup.ts:401` 接线）；错误语义（`lastError` code 词表与 msg 键选择：`'unexpected-exit'` `:72`、`'webcam-missing'` `:124`）现状全在 devices 层；给 runner 加环境语义会污染 P3 刚定型的进程池抽象。挂点写法：`process.platform === 'win32' && looksLikeWhpxMissing(info)` → 专用 code 与文案（含原始 detail 与「在 Windows 功能中开启『Windows 虚拟机监控程序平台』」指引）；mac 上分类器永不执行。文本样本（真机采样前的保守实现，匹配两 tail 拼接、大小写不敏感）：① `x86 emulation currently requires hardware acceleration`（官方致命句式，线上样本已核实）；② `Windows Hypervisor Platform` 同现 `not installed`。只锚整句高信号模式，不做 `WHPX.*failed` 这类宽匹配（运行期警告日志会误伤）；**「WHPX 错误输出真实样本采样」列真机项**，采样后回填 `whpx.ts` 模式常量。
4. **深链三分支结构**：摄像头——`cameras.ts` 出 `cameraSettingsUrlFor(platform)`（darwin → 现有 `x-apple.systempreferences:…Privacy_Camera` 原串、win32 → `ms-settings:privacy-webcam`、其余 null 即 no-op），`sdkIpcSkins.ts:75` 的 handler 改调它（null 直接返回，维持现有「非 darwin 无动作」行为）。WHPX——不共用向导的 `sdkCameraSettings`（它 `requireWizardSender` 锁向导窗，而启动失败展示在主窗设备行），按 `shellShowItemInFolder` 先例在 dialog 域开固定 URI 受控通道：renderer 无参可传、非 win32 拒绝，无注入面。按钮可见性只由 `lastError.code === 'whpx-missing'` 驱动（该 code 仅 win32 收口产生，renderer 无需再判平台）。
5. **摄像头空列表口径（论证）**：不改 `cameraPermission`/`requestCameraPermission` 的「非 darwin → granted/true」——Windows 的相机隐私总开关面向 UWP 有细粒度 API、对桌面应用只有全局拦截且 Electron 无查询通路；`-webcam-list` 空列表已经是「被拦或无设备」的地面真相，把 permission 假装成可探测状态反而撒谎。因此只做两件事：win32 空列表的错误文案换 `cameraNoneFoundWindows`（指向系统隐私设置而非 mac 的「本应用权限」概念，darwin 原键原文案不动）；向导的「打开摄像头权限设置」按钮在 win32 空列表时也显示（现条件 `['denied','restricted']` 在 win32 恒假，补了深链也永远看不到入口）。刷新按钮既有行为不变。
6. **mac 零回归**：过滤仅 win32 生效（mac 目录照列全 ABI）；`assessImageCompatibility` 缺省参数即现值；下载守卫 mac 侧比较对象不变；分类器与深链通道 win32-gated；darwin 摄像头深链与文案逐字节不变；`SettingsForm` 新增按钮条件在 mac 恒假；`preferredAbi`/`abiReadOnlyCrossArch` 不动。

## Build order

1. shared ABI 单源 + compatibility `hostAbi` 参数 + catalog 过滤接缝 + 下载/创建守卫接线 + `compatCrossArch` 三语改写 + 单测（compatibility：win32 参数下 x86_64 supported/arm64 unsupported、缺省参数回归；catalog：`deps.platform='win32'` 只剩 x86_64（远端+本地独有条目）、缺省平台全量零变化）。
2. `whpx.ts` 匹配器 + `handleUnexpectedExit` 挂点 + i18n `whpxMissing` + 受控深链通道（ipc-channels/main dialog/preload）+ DeviceRow 按钮 + `openWindowsFeatures` 文案 + 单测（whpx 纯函数；startup 经 harness 的 `createRunner` deps 捕获驱动 `onUnexpectedExit` 断言 code 与 message；dialog mock shell 断言 URI 与平台拒绝；DeviceListPane 按钮渲染与点击）。
3. 摄像头深链三分支 + `cameraListEmptyMessage` + `cameraNoneFoundWindows` 三语 + `SettingsForm` 按钮条件 + 单测（cameras 纯函数三平台/两 permission；sdkIpcSkins 分支经 URL 单源函数覆盖）。
4. 全套回归 + typecheck/lint/prettier + book 收尾（主会话统一）。

## Test plan

- 单测（compatibility / catalog）：`hostImageAbi` 两分支；win32 参数下 x86_64 → supported、arm64-v8a → unsupported 且理由含新文案；缺省参数与既有用例零改动；`fetchImageCatalog` win32 过滤（含 localOnly 路径与本地独有条目）、mac 全量。
- 单测（whpx / startup）：两 tail 命中 canonical 样本（stdout-only、stderr-only、混合）；普通崩溃文本与端口冲突文本不命中；win32 收口写 `code:'whpx-missing'` 且 message 含「Windows 虚拟机监控程序平台」指引与原始 detail；未命中维持 `'unexpected-exit'`（既有断言不动）。
- 单测（dialog / DeviceListPane）：深链通道仅 win32 放行且 URI 固定；按钮随 code 出现/消失、点击调用 api。
- 单测（cameras / SettingsForm 域）：`cameraSettingsUrlFor` 三平台；`cameraListEmptyMessage` win32/granted → 新键、darwin/granted → `cameraNoneFound` 原文、denied/restricted 两平台均原键；按钮条件 win32 空列表为真、mac 恒假。
- 回归：全套既有用例零改动；typecheck/lint/prettier。
- 真机（延后到统一集成阶段）：**WHPX 错误输出真实样本采样**（关 WHPX 启动模拟器，采集 stdout/stderr 全文回填匹配清单）；识别 → 深链打开「Windows 功能」→ 勾选 Windows 虚拟机监控程序平台 → 重启后可跑的完整剧本；`ms-settings:privacy-webcam` 深链真实拉起与开启后 `-webcam-list` 恢复枚举；win32 下 x86_64 镜像「列-下-建-跑」全链与 arm64 镜像隐藏验证。

## Done criteria

- 全套测试全绿且既有用例零改动；win32 过滤/识别/深链分支单测齐；三语新键（`whpxMissing`/`cameraNoneFoundWindows`/`openWindowsFeatures`）与 `compatCrossArch` 改写落位；调研 §5（D1/D2/D3）落地路径逐条对上（目录过滤+文案、失败识别+引导、深链分支+空列表口径）；「不做」清单（主动探测/权限探测改动/preferredAbi）在 plan 与代码注释中口径一致；真机项明确归统一集成验证阶段；book 收尾完成（主会话统一）。
