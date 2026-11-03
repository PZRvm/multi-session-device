---
description: 主题状态迁主进程持久化——theme.json 单一事实源，重启保留亮暗模式与主题色，建窗零白闪
status: completed
created: 2026-10-06
---

# 主题持久化（重启保留亮暗状态） — plan

> 实施完成（2026-10-06）：全部批次落地；vitest 254 用例（含新增 30+）全绿、typecheck/build/lint 干净；真机验收过——CDP 切暗落盘 theme.json、优雅退出重启首帧整窗深色无白闪（截图存证）、legacy localStorage 收编清键、损坏文件缺省起步不覆写。
>
> Phase 5 review（同日，八项检查单过 diff）：两项 P3 进 issue——[persist 并发 tmp 串写](../notes/issue/2026-10/2026-10-06-theme-persist-concurrent-tmp-clash.md)、[跨窗主题不同步（存量）](../notes/issue/2026-10/2026-10-06-theme-no-cross-window-sync.md)；一项小重复记录在案——`ResolvedMode` 类型与亮暗解析逻辑在 main（resolvedThemeMode）与 renderer（resolveMode）各一份，可下沉 shared 合并纯函数，暂不动。
>
> 复审修复（同日，用户拍板全修）：三项全部收口——persist 落盘 writeQueue 串行化；`theme:changed` 广播 + 各窗 store 直写跟随（跨窗同步）；亮暗解析下沉 shared `resolveThemeMode` 单源（main/renderer 复用，apply.ts 的 resolveMode 变 matchMedia 侧薄包装）。252/252 用例绿（新增 3），typecheck/build/lint/prettier 干净；真机复验过——向导窗打开状态下主窗切暗 1s 内跟随、重启经新串行落盘正确恢复 dark。

依据：用户需求「切换白天黑夜模式后，关闭程序重新打开要保留上次状态」+ 代码注释里既定的迁移方向（themeStore：「stage 05 设置窗落地时迁 IPC 后端，接口不变」；themeSystems：「首帧正确依赖主进程侧主题持久化，那是设置窗的活」）。本 plan 把这块前置件提前独立落地，不做设置窗 UI。

## Requirements brief

### 背景与目标

现状调研结论：renderer 侧 zustand persist（localStorage 键 `app-theme`）其实是活的，**同源**重启能恢复 CSS 主题。用户看到「状态丢了」来自三个真实缺口：

1. **dev 跨端口即跨源**。localStorage 按源隔离，主仓 6174 与各 worktree（6175/6177…）各一份互不相通——换窗口跑 dev，主题就「重置」。
2. **主进程不知道主题**。建窗不设 `backgroundColor`（默认白）、`nativeTheme.themeSource` 启动期跟随系统——暗色用户重启首帧白闪、macOS 原生三灯错色，观感即「没保留」。
3. 生产 `file://` 源下 localStorage 虽能持久，但主进程侧仍是盲区（缺口 2 的根因）。

实施前先在固定端口 dev 复核一遍诊断：同源重启 CSS 应已保留、白闪与三灯错色应可复现；对不上则先修诊断再动工。

目标：主题状态（systemId + mode）以主进程 `userData/theme.json` 为单一事实源；启动在建窗前恢复 nativeTheme 与窗口底色；renderer 经 preload 同步取初值，首帧即正确；重启后亮暗与主题色原样保留，与 dev 端口无关。

### 本期范围

- 主进程主题 store：theme.json 读写（守卫 + 原子替换）。
- boot 时序：恢复 nativeTheme → 建窗（主窗 + 向导窗）注入 backgroundColor；主题变化全窗 setBackgroundColor。
- IPC：`theme:set-mode` 扩展为落盘；新增 `theme:get-sync`（同步初值）、`theme:set-system-id`。
- renderer：themeStore 撤 persist、初值来自主进程、setMode/setSystemId 落盘；provider 移除重复的 setMode IPC effect；legacy localStorage 一次性收编。

### 不影响（排除项）

- 不做设置窗 UI 与三主题色色板（stage 05 [suggested] 步骤）；`theme:set-system-id` 只保证链路通，UI 归 stage 05。
- 不动 `global.css` 的 `:root` 缺省块（无 JS 期琥珀缺省 + 对账基准）与 themeSystems 色值。
- 不动 devices.json、emulator/scrcpy 域；不做主题导出/导入、多 profile。

### 已有计划与边界

- stage 05 设置窗（[suggested]，plan 待写）：本 plan 是其「主进程侧主题持久化」前置件；实施收尾时在 stage 05 以 [suggested] 步骤附注引用，不自行转正。
- 三灯系列 plan（2026-10-04-native-traffic-lights 等）已交付的集成不受影响——`nativeTheme.themeSource` 语义不变，只是恢复时机提前到建窗前。

## Impact range

数据流：renderer setMode/setSystemId → themeStore 乐观更新 → IPC → main 校验 → 内存 + theme.json 原子落盘 → nativeTheme + 全窗 bg 刷新。boot：main 读 theme.json → nativeTheme.themeSource → 建窗 backgroundColor → preload sendSync → themeStore 初值 → useLayoutEffect 注入 CSS 变量（首帧正确）。

| 文件或模块                                              | 改动                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/main/theme/store.ts`（新增）                       | theme.json 读写、字段守卫、tmp+rename 原子写、内存态与 fresh 标志 |
| `src/main/theme/index.ts`                               | 三通道接线；set 处理器统一做校验→落盘→nativeTheme→全窗 bg         |
| `src/main/index.ts`                                     | whenReady 先恢复主题（nativeTheme）再建窗                         |
| `src/main/window/index.ts`、`src/main/window/wizard.ts` | 建窗 `backgroundColor = themeBoardBackground(systemId, resolved)` |
| `src/shared/ipc-channels.ts`                            | 增 themeGetSync / themeSetSystemId                                |
| `src/preload/api/theme.ts`                              | `initial`（sendSync 初值）、setSystemId；类型经 Api 自动透出      |
| `src/renderer/src/stores/themeStore.ts`                 | 撤 persist、初值取 initial、动作落盘、legacy 收编                 |
| `src/renderer/src/theme/index.tsx`                      | 移除 setMode IPC effect（职责并入主进程 set 处理器）              |
| 相应模块 `__tests__/`                                   | 见 Test plan                                                      |

主要风险：sendSync 阻塞（内存应答、单次，量级可忽略）；双源残留（persist 撤除 + 收编清键收口）；theme.json 与 nativeTheme 半更新（set 处理器内顺序化：先内存后副作用，落盘失败降级为「本次会话生效」）。

## Design

### 1. 主进程 theme store（新 `src/main/theme/store.ts`）

- 文件 `userData/theme.json`，schema `{ version: 1, systemId: ThemeSystemId, mode: ThemeMode }`。
- 读取容错照 devices.json 先例（store.ts）：无文件 = 首启缺省（amber/system）；损坏或字段非法 = 缺省起步，原文件不被静默改写，下次合法写入才覆写。守卫复用 `isThemeSystemId` + mode 三值闭集。
- 写入唯一入口：内存更新 → tmp + rename 原子替换。
- `fresh` 标志：本次启动 theme.json 不存在时为 true，供 renderer legacy 收编判定。

### 2. boot 时序与窗口底色

`app.whenReady`：读主题 → `nativeTheme.themeSource = mode` → createMainWindow。建窗（主窗/向导窗）`backgroundColor = themeBoardBackground(systemId, resolved)`，其中 `resolved` 提为纯函数（如 `resolvedThemeMode(state, shouldUseDarkColors)`）：mode 显式亮暗直读；`system` 由 `nativeTheme.shouldUseDarkColors` 决定——themeSource 已先行设置，该值即系统解析结果。

运行中系统翻转（mode='system'）：renderer CSS 走既有 matchMedia 监听；主进程监听 nativeTheme `updated` 更新全部窗口 setBackgroundColor（三灯由系统天然跟随）。显式 setMode/setSystemId 的 set 处理器内同样全窗刷新。

### 3. IPC 与 preload

- `theme:set-mode`（既有，语义扩展）：校验 → store 更新+落盘 → `nativeTheme.themeSource` → 全窗 bg。返回 void，错误经 invoke reject 到 toApiResult。
- `theme:set-system-id`（新）：同上，减 nativeTheme 步。
- `theme:get-sync`（新）：`ipcMain.on` + `event.returnValue`（sync 通道不可用 handle），返回 `{ systemId, mode, fresh }`，全部来自内存、无磁盘 IO。
- preload：`themeApi.initial = ipcRenderer.sendSync(IPC_CHANNELS.themeGetSync)`，模块加载时取一次（是值不是函数）；sandbox preload 可用 sendSync。弃异步 get 的理由：会产生「首帧默认琥珀」闪变，违背零闪目标。

### 4. renderer 迁移

- themeStore：初值 `window.api?.theme?.initial`（缺省 amber/system；jsdom 测试无 preload 时不炸），撤 persist。setMode/setSystemId：乐观 set + `void toApiResult(...)` 落盘，失败 console.error 不回滚——本次会话生效、下次启动回退，与主进程「内存先行」语义对齐。
- legacy 收编（一次性）：boot 后若 `initial.fresh` 且 localStorage `app-theme` 有合法 state → 调 setMode/setSystemId 收编 → 移除该键。多 dev 端口各有存量时以最先启动的源为准（theme.json 一旦存在 fresh 即 false）。位置实施时取更可测的挂点（themeStore 模块尾部自执行或 provider 首个 effect）。
- DeviceThemeProvider：移除 setMode 的 IPC effect；applyTheme + matchMedia 监听不动。

### 5. 验收判据（真机）

切暗 → Cmd+Q 退出 → 重开：无白闪、三灯暗、板面暗，全程不出现琥珀浅色帧；切亮与跟随系统同理。跟随系统下系统翻转：页面、原生三灯、窗底三处即时一致。dev 双端口（主仓 6174 与本 worktree 6175）交替启动状态一致。theme.json 手改损坏 → 缺省起步不崩，下次合法写入自愈。旧 localStorage 键收编一次后被清除。

## Build order

1. **主进程 theme store。** store.ts + 单测（缺省/损坏/非法字段/原子写内容）。验证：vitest 全绿。
2. **boot 接线 + 建窗底色。** index.ts 时序、两窗 backgroundColor、resolvedThemeMode 纯函数 + 单测、nativeTheme.updated 全窗刷新。验证：单测 + 真机首帧无白闪。
3. **IPC 三通道 + preload。** 通道注册与校验、preload initial。验证：主进程单测（非法参数拒绝、get-sync 返回内存值）+ typecheck。
4. **renderer 迁移。** themeStore 撤 persist、动作落盘、legacy 收编；provider effect 收敛；改造既有 themeStore/provider 测试。验证：vitest + typecheck。
5. **真机验收 + book 收尾。** 按 Design 5 清单逐条过；stage 05 附 [suggested] 引用；learn/issue 记录；`npm run book:index`。

## Test plan

自动化（Vitest，各模块 `__tests__/`）：

- store：无文件缺省、JSON 损坏缺省且不覆写、非法 systemId/mode 过滤、写入 tmp+rename 的内容与版本号、fresh 标志。
- IPC：set-mode 非法参数 reject 且不落盘、合法更新内存与文件、set-system-id 同律、get-sync 返回内存快照。
- 解析纯函数：system 由 shouldUseDarkColors 决定、显式亮暗直读。
- themeStore（jsdom）：无 window.api 时初值缺省不炸、有 initial 时采用、setMode 乐观更新 + API 调用、收编路径（fresh + 合法 legacy → 收编清键；非 fresh 不动）。
- 既有 provider/BoardHead 回归；`npm test`、`npm run typecheck`、`npm run build`；lint 与存量基线比较不新增错误。
