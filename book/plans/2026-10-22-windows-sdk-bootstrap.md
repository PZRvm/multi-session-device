---
description: SDK 引导 Windows 平台化——下载源按平台查表、sdkPaths 补 .exe/.bat、platformExec 执行器（cmd.exe /c + windowsHide）、解压改 Windows 自带 tar.exe；Win P1，依赖主体工程调研
status: completed
created: 2026-10-22
---

# Windows SDK 引导平台化 — plan

> 实现记录（2026-10-22，feature/windows-sdk-bootstrap，基 c77fbe4）：新增 `platformExec.ts`（resolveCommand/spawnCommand/tarBinFor——win32 `.bat` 经 `cmd.exe /c`、统一 `windowsHide`；deps.platform 接缝）；`sdk.ts` 钉版源改平台查表（win32 四值 `TODO-windows` 占位 + bootstrapSdk 入口占位守卫抛 `sdkWindowsSourcePending`，禁止带占位值真跑）、`sdkPaths(root, platform)` 五路径后缀与 jreHome 布局分支（darwin 快照钉住零回归）、JRE 归位 win32 整目录 rename（无 Contents 层）、defaultRunner/uninstall/defaultUnpacker 换 spawnCommand；`downloader.ts` extractZip 平台分支（win32 `tar.exe -xf -C`，mac 维持 unzip，导出 `extractZipCommand` 供测）；`avd.ts` avdmanager/JAVA_HOME 切 sdkPaths 单源；`cameras.ts` 探针路径走 emulatorBin + windowsHide。i18n 三语补 `sdkWindowsSourcePending`。新增单测 14 例（platformExec 6 / sdk win32 6 / downloader 2），全套 1330 过、既有用例零改动、typecheck/lint 0 错。Win32 哈希真值与真实 bootstrap 属统一真机集成阶段（todos 备注），此处不做。经验落 learn 2026-10-22-windows-spawn-bat-tar-exe。
> review 修复轮（2026-10-22，发现见 issue 2026-10-22-windows-sdk-bootstrap-review）：P3-1 未登记平台（linux）改落占位源由入口守卫拒绝（不再静默回退 darwin——装错平台的二进制比显式失败更糟）；P3-2 `extractZip` 抽 `makeExtractZip(platform)` 工厂接缝，win32 分支在 mac 上可测（ENOENT 证实 tar.exe 解析 + darwin 真解压冒烟）；P3-3 `spawnCommand` 的 windowsHide 改「默认 true、调用方可覆盖」；P3-4 `createAvd` 解构单次 `sdkPaths`。P2-1（cmd.exe 含空格路径真实解析）保持 open，归 Windows 真机集成验证。修复后全套 1334 测试过、typecheck/lint 0 错。

> 依据：[主体工程调研](../notes/think-report/20261022125639-Windows适配主体工程调研.md) 单元 F（§2）与 G（§3），假设已全部批复（只做 x64、mac 零改动、哈希真机阶段填）。任务清单见 [todos](../todos/windows-support.md) P1。
> 边界声明：本 plan 落到「win32 分支单测级可走通」为止；Windows 下载源哈希真值、真实 bootstrap 全流程归六份计划后的真机集成验证阶段（在 Windows 笔记本上做），不在本 plan 门禁内。

## Requirements brief

- 作用域：`bootstrapSdk` 全链的 win32 分支——钉版下载源按平台查表、`sdkPaths` 二进制路径后缀与 JRE 布局、JRE/cmdline-tools 归位逻辑、解压命令平台分支（bootstrap 的 `defaultUnpacker` 与镜像下载的 `extractZip` 两处）、引导链 spawn 统一走新 `platformExec`（`.bat` 规则 + `windowsHide`）。
- 排除项：Windows 下载源哈希与 sha256 真值（占位显式标注，真机阶段填——禁止抄网页猜值）；检测链（P2）；runner 长驻进程 spawn 与树杀（P3）；rename 重试/跨卷回退/sha1 流式化（P4）；镜像目录 ABI 过滤（P5）。
- 边界：全部改动为 `win32` 条件分支，mac 路径输出逐字节不变（现有单测零改动全绿为证）；钉版纪律保留（升级＝显式改表＋真机集成，见 `sdk.ts:10` 既有注释）。
- 验收要求：win32 各分支单测覆盖（假源注入走通 bootstrap 全流程、解压命令形态、`.bat` 包装、windowsHide）；现有全套测试零改动通过；typecheck/lint 0 错；win32 哈希占位在代码中显式可见（TODO 标注 + 走到即抛明确错误，防止带占位值真跑）。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/main/emulator/platformExec.ts`（新增） | 平台执行器：win32 下 `.bat`/`.cmd` 经 `cmd.exe /c` 包装、统一 `windowsHide: true`；平台判定走接缝注入可单测 |
| `src/main/emulator/sdk.ts` | `PINNED_SOURCES` 改按平台查表（darwin 值照抄现值；win32 值 TODO 占位 + 入口守卫）；`sdkPaths` 五条二进制路径加后缀、`jreHome` 布局平台分支；`bootstrapSdk` JRE 归位 win32 分支（zip 顶层即 jre 根）；`defaultRunner`/`uninstallSdkManagerPackage` 的 spawn 换 `platformExec`；`defaultUnpacker` win32 用 `tar.exe` |
| `src/main/emulator/downloader.ts` | `extractZip` win32 分支：`unzip` → `tar.exe -xf`（bsdtar 同源，官方确认可解 zip）；windowsHide；取消（AbortSignal kill 子进程）逻辑复用不动 |
| `src/main/emulator/avd.ts` | `avdmanager` spawn 换 `platformExec`；`JAVA_HOME` 走 `sdkPaths` 平台化的 `jreHome`（现值 `:66` 的 mac 布局拼接删除） |
| `src/main/emulator/cameras.ts` | `-webcam-list` 探针 spawn 补 `windowsHide` |
| `__tests__/`（emulator 域） | platformExec / sdkPaths / 双源 bootstrap / 解压分支 / 归位布局用例 |

风险：`cmd.exe /c` 转发后 sdkmanager 进度行（`\r` 分隔）是否原样到达——`parseSdkManagerPercent` 依赖行内容。处置：platformExec 单测断言转发输出保真；若有行尾污染（`\r\n` 化），在 `defaultRunner` 的既有 split(`\r`) 处已兼容（`:331`）。Temurin win zip 顶层目录名（`jdk-21.x+y-jre` 形态）以真机实测为准，归位逻辑按「顶层唯一非隐藏目录」通用处理，与 mac 侧同法（`sdk.ts:408-410` 既有模式）。

## Design

1. **platformExec**：`runCommand(deps, bin, args, opts)`——`deps.platform` 接缝（默认 `process.platform`）；win32 且 bin 以 `.bat`/`.cmd` 结尾 → `spawn('cmd.exe', ['/c', bin, ...args], …)`；其余直接 spawn；options 恒加 `windowsHide: true`（posix 无副作用）。返回 ChildProcess 形态，调用方现有的 stdout 逐行/错误收口逻辑不变。**不抽象成通用执行器**——只服务引导链短命令；runner（P3）平行自理，plan 间已约定不合并。
2. **双源查表**：`PINNED_SOURCES: Record<'darwin' | 'win32', BootstrapSources>`；win32 条目的 url/sha 填 `'TODO-windows'` 占位，`bootstrapSdk` 入口在 win32 且值为占位时抛 `msg('sdkWindowsSourcePending')` 类明确错误（i18n 键随本 plan 落三语）；单测经既有 `BootstrapDeps.sources` 接缝注入假源，不碰真值。
3. **sdkPaths 平台化**：win32 返回 `jreHome: join(root,'jre')`、`javaBin: …/bin/java.exe`、`sdkmanagerBin`/`cmdlineToolsMarker`/`avdmanagerBin`: `…/bin/sdkmanager.bat`/`avdmanager.bat`、`adbBin: …/platform-tools/adb.exe`、`emulatorBin: …/emulator/emulator.exe`；darwin 返回值与现状逐字节一致（单测快照钉住）。
4. **JRE 归位 win32**：Temurin win zip 解出顶层 `jdk-21…-jre/`（内含 `bin/`，无 `Contents` 层）→ `rename(join(tmp, top), join(root, 'jre'))`；mac 保持现 `Contents` 归位。cmdline-tools 归位（zip 顶层 `cmdline-tools/` 两平台一致）不动。
5. **解压平台分支**：`sdk.ts` `defaultUnpacker` spawn 命令 win32 `'tar.exe'`/darwin `'tar'`（参数同）；`downloader.ts` `extractZip` win32 `execFile('tar.exe', ['-xf', zipPath, '-C', targetDir], …)`/darwin 维持 `unzip -q -d`；均补 windowsHide。取消分流（signal kill → CancelledError）零改动。
6. **不做**：`.bat` 之外的脚本类型（`.ps1` 不用）；`shell: true`（Node 文档提示注入风险，显式 `cmd.exe /c` 更可控）；长路径检测（P6）。

## Build order

1. `platformExec.ts` + 单测（`.bat` 包装、非 `.bat` 直呼、windowsHide 断言、darwin 透传——注入 platform 与 spawn 接缝）。
2. `sdkPaths` 平台化 + darwin 快照单测（钉住不变）+ win32 各路径断言；`avd.ts`/`sdk.ts` 的 JAVA_HOME 引用切到 `sdkPaths`。
3. 双源查表 + 占位守卫 + i18n 键 + 单测（假源走通 win32 bootstrap 全流程：licenses → jre → cmdline-tools → 两包，断言归位布局与调用序列）。
4. 解压两处平台分支 + 单测（win 命令形态、取消路径回归）。
5. 调用点收口（`defaultRunner`/uninstall/avdmanager/cameras 换 platformExec 或补 windowsHide）+ 全套回归 + typecheck/lint。

## Test plan

- 单测：platformExec 三形态；sdkPaths 两平台快照；win32 bootstrap 假源全流程（归位布局、占位守卫抛错）；extractZip/defaultUnpacker win 命令与取消回归；cameras spawn options 断言。
- 回归：现有 emulator 域全部用例零改动全绿（mac 行为不变的证明）；typecheck/lint/prettier。
- 真机（延后到统一集成阶段）：win zip/sha 真值填入后真实 bootstrap 一次；`.bat` 真实执行；tar.exe 解 2GB 镜像。

## Done criteria

- 全套测试全绿且既有用例零改动；win32 分支均有单测；哈希占位守卫与 TODO 显式；调研报告 F/G 落地路径逐条对上；book 收尾（本 plan 状态、learn/issue 记录、索引刷新）。
