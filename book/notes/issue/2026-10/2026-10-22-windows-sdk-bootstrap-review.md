---
description: Windows P1 SDK 引导平台化 code review——0 项 P1、1 项 P2（cmd.exe 含空格路径待真机验证）、4 项 P3；本轮只记录未修
created: 2026-10-22
status: open
---

# Windows P1（SDK 引导平台化）code review

基线：`feature/windows-sdk-bootstrap` 的 `1bdb2f3`（基 `c77fbe4`，src 约 +369/−46）。方法：本人对提交 diff 全量复读（platformExec / sdk / downloader / avd / cameras / i18n / 三测试文件），逐条核对外部调用方影响面（`detectSdk`/`sdkPaths` 签名变化的全部调用点、循环依赖、占位守卫时序）。本轮只记录，未修任何一条。

严重度口径沿 issue 2026-10-10：P1=数据丢失/安全/主流程破坏；P2=特定条件可触发的状态破坏或核心交互失效；P3=一致性/小问题/测试缺口。门禁实测：vitest 1330 全过（既有用例零改动）、typecheck/lint 0 错。

## 结论

无 P1。占位守卫时序正确（先抛错后动盘，`bootstrapSdk` 入口在 `mkdir(root)` 之前）；取消路径（AbortSignal→kill→CancelledError 分流）零改动；cameras/avd 引 sdk 无循环依赖；darwin 返回值有快照用例逐字节钉住。

## P2（1 项）

### P2-1 `cmd.exe /c` 包装在含空格路径下的真实行为待真机验证

`platformExec.ts` 的 `resolveCommand` 生成 `spawn('cmd.exe', ['/c', bat, ...args])`——Node 逐参加引号后命令形如 `cmd.exe /c "C:\a b\sdkmanager.bat" --sdk_root "C:\Users\John Doe\sdk"`。cmd.exe 的 `/c` 引号剥离规则（恰好两对引号时剥外层等）对多引号命令行按保留处理，此形态理论可用，但单测无法覆盖 cmd.exe 的实际解析——而本应用 Windows 自管 SDK 根在 `%APPDATA%` 下，**用户名含空格是常见现实**（bat 路径与 `--sdk_root` 参数值同时带空格）。方向：Windows 集成验证清单加一条「用含空格用户名的 Windows 账号真实跑一次 bootstrap」（P1 plan 实现记录已列真机项，本条把路径形态点明）；若真机暴露解析问题，备选方案是给 `spawnCommand` 加 `windowsVerbatimArguments` + 显式整体引号，或改走 `execFile(bin, args, { shell: 'cmd.exe' })` 语义核对。

## P3（4 项）

### P3-1 `sourcesFor` 对未登记平台（linux）静默回退 darwin 钉版源

`sdk.ts` 的 `PINNED_SOURCES` 查表对 linux 回退 `DARWIN_SOURCES`——linux 上 bootstrap 会下载 macOS 二进制（改造前单源同样行为，非回归；linux 本就不在一期范围）。但既已引入查表+占位守卫机制，linux 更合理的行为是同 win32 一样「未钉版显式抛错」而非静默装错平台。方向：未登记平台返回占位源让守卫接管（删 `?? DARWIN_SOURCES` 回退），或显式登记 linux 为 pending 值。

### P3-2 `defaultDeps.extractZip` 直读 `process.platform`，无平台接缝

`downloader.ts` 的默认实现在函数体内读 `process.platform`——与 platformExec 的 `deps.platform` 注入风格不一致；win32 分支在 mac 上只能测 `extractZipCommand` 纯函数形态（已测），默认实现的真实子进程行为归真机。方向：如需 mac 侧覆盖 win 分支，给 `DownloaderDeps.extractZip` 的默认实现抽 `makeExtractZip(platform)` 工厂或加 platform 接缝。

### P3-3 `spawnCommand` 无条件覆盖调用方的 `windowsHide`

`platformExec.ts` 的 `{ ...options, windowsHide: true }` 在 spread 之后——调用方显式传 `windowsHide: false` 会被吞。当前无此调用需求，但语义上「默认 true、可覆盖」更稳。方向：`windowsHide: options.windowsHide ?? true`。

### P3-4 `createAvd` 内 `sdkPaths(dirs.sdkRoot)` 连续调用两次

`avd.ts` 的 `avdmanagerBin` 与 `JAVA_HOME` 各调一次 `sdkPaths`——可解构一次（纯风格，两对象内容一致无正确性问题）。

## 附带核对（无发现）

- `detectSdk`/`sdkPaths` 新增参数均带默认值：外部调用方 `sdkIpcShared.ts:186`、`sdkIpcSource.ts:29/:113`、`sdkMigration.ts:110`、`profiles.ts` 的 `sdkPaths` 用法全部不受影响。
- 占位守卫对 `deps.sources` 注入路径同样生效（真机填值前即使误注入也会被 `isPinnedSourcePending` 拦截，注入真实假源的单测不受影响）。
- `sdk.test.ts` 的 win32 用例断言 `platformTools.version` 为 undefined 与该用例未写 source.properties 一致，非断言削弱。
- i18n 三语 `sdkWindowsSourcePending` 齐全（`ErrorsCopy` 类型约束下缺键即 typecheck 失败，已过）。
