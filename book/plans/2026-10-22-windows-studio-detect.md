---
description: Studio/SDK 检测链 Windows 分支——studioDetect 四条候选链平台化（零注册表）、adb 系统候选补 Windows 路径、路径比较大小写规范化；Win P2，依赖主体工程调研
status: completed
created: 2026-10-22
---

# Windows Studio/SDK 检测链 — plan

> 实现记录（2026-10-22，feature/windows-studio-detect，基 c77fbe4）：`studioDetect.ts` 按 Design 全量落地——`Deps.platform` 接缝（默认 `process.platform`，既有测试零注入零变化）；四条候选链 win32 分支（configRoot `%APPDATA%\Google`、绝对路径形状收盘符正反斜杠 + `normalize` 收敛、默认目录 `%LOCALAPPDATA%\Android\Sdk`、PATH 按 `;` 反推 `adb.exe`）；Studio 本体 win32 固定目录探测（`C:\Program Files\Android\Android Studio`，`bin\studio64.exe` 在场即采纳，**mdfind 在 win 分支不可达**——单测断言）；jbr 布局 win `<studio>\jbr` + `java.exe`；`isStudioSdk` win32 大小写不敏感比较（直接判等短路与 realpath 对比都走 lowercase，posix 零改动）。**顺带接缝修复**：`defaultAdbOnPath` 原持有 `fileExists` 接缝却写死 `defaultFileExists`——接缝自始未生效（既有 darwin 测试全走 `adbOnPath` 注入故未暴露），改为优先注入（默认行为不变，win32 默认实现从此可单测），教训落 learn 2026-10-22。`adb.ts`：`candidateAdbPaths` 加可选 deps（env/homedir/platform），win 分号分隔 + `adb.exe` 后缀 + `%LOCALAPPDATA%` 标准候选（缺省回退 homedir\AppData\Local）；`runAdb` spawn 补 `windowsHide`。测试 +9（win 检测链 5、isStudioSdk win 2、adb 候选 2），全套 1325 过（6 skip 原有；中途一轮 1 例偶发失败完整复跑未复现）、typecheck/lint 0 错、prettier 干净。评审只记录未修：分支 4 平台传参 `isWin ? 'win32' : undefined` 欠雅；`sdkMigration.ts:296` 的 adb 探测 win 假阴性记 issue 2026-10-22。真机对照（真装 Studio 的 `%APPDATA%` 配置形态回填）归 Windows 集成收口阶段。Phase 5 review（2026-10-22）：4 项 P3（分支 4 平台传参风格、configRoot/defaultSdkPath 未优先读 env 且与 adb.ts 口径不一致、两条 win 用例的 runner 可携带性、isStudioSdk 遗留未用声明），见 [issue](../notes/issue/2026-10/2026-10-22-windows-studio-detect-review.md)——只记录未修，不阻塞合并。

> 依据：[主体工程调研](../notes/think-report/20261022125639-Windows适配主体工程调研.md) 单元 H（§4，含已批复的「零注册表」修订）与 [外围调研](../notes/think-report/20261022110137-Windows兼容问题解决方案调研.md) B2（大小写规范化）。任务清单见 [todos](../todos/windows-support.md) P2。
> 与 P1 无代码依赖（不同文件群），可并行施工。

## Requirements brief

- 作用域：`studioDetect.ts` 检测链四条候选（Studio 配置文件 → 环境变量 → 平台默认目录 → PATH 反推）的 win32 分支；Studio 本体固定目录探测（替代 `mdfind`，零注册表）；`adb.ts` 系统 adb 候选链的 win32 路径；`isStudioSdk` 路径比较的大小写规范化。
- 排除项：注册表查询（backlog 可选增强，有真机后再评估）；`sdkMigration.ts:296-298` 自带的 `platform-tools/adb` 探测（win 下会假阴性——**收尾时记 issue，不在本 plan 修**，范围纪律）；jbr 缺失时的共享模式 Java 兜底（现状逻辑已兜，不动）；设置页 SDK 路径展示（读 `defaultSdkPath` 字段，自动受益）。
- 边界：`Deps` 加 `platform` 接缝（默认 `process.platform`），现有测试不注入即 darwin——行为不变；检测顺序与字段结构（`StudioSdkDetection`）零变化。
- 验收要求：win32 各分支单测覆盖（固定目录探测、配置目录解析、默认路径、PATH 反推、大小写规范化）；darwin 全部现有用例零改动全绿；`mdfind` 在 win32 分支被明确不调用（单测断言）。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/main/emulator/studioDetect.ts` | `Deps.platform` 接缝；configRoot、绝对路径形状判断、defaultSdkPath、Studio 本体探测、jbrHome、PATH 分隔符与 `adb.exe`、`looksLikeSdkRoot`、`isStudioSdk` 大小写比较——逐项 win32 分支 |
| `src/main/emulator/adb.ts` | 候选链头部补 win32 候选 `join(env.LOCALAPPDATA ?? join(homedir(),'AppData','Local'), 'Android','Sdk','platform-tools','adb.exe')`；探测 spawn 补 windowsHide |
| `__tests__/`（studioDetect / adb） | win32 分支用例 + darwin 回归 |

风险：Windows 上 Studio options/*.xml 里 SDK 路径的字段形态与写法（正斜杠/反斜杠混排）无法在 mac 侧实证。处置：形状判断放宽为「盘符开头（`/^[A-Za-z]:[\\/]/`）」并在 `$USER_HOME$` 展开后统一 `path.normalize`；最终仍经 `looksLikeSdkRoot` 核验才采纳（与 mac 侧同构的防漂移设计）；真机阶段拿真实配置文件回填用例（集成验证清单项）。

## Design

1. **platform 接缝**：`StudioDetectDeps` 加 `platform?: NodeJS.Platform`（默认 `process.platform`）；`isWin` 局部布尔贯穿各分支。
2. **分支 1（Studio 配置文件）**：`configRoot` win32 → `join(home, 'AppData', 'Roaming', 'Google')`（官方 troubleshooting 页口径，与 mac 同构）；`extractConfigCandidates` 的 `value.startsWith('/')` 改平台形状函数（win 盘符正则）；`SDK_PATHISH_RE` 已兼容 `\\`（`:130`）不动；展开后 `normalize`。
3. **分支 2（环境变量）**：平台无关，不动。
4. **分支 3（默认目录）**：win32 → `join(home, 'AppData', 'Local', 'Android', 'Sdk')`。
5. **Studio 本体（win32）**：固定路径探测 `C:\Program Files\Android\Android Studio`（`bin\studio64.exe` 在场即采纳）；**不调 mdfind**（win 分支跳过 `:152-159` 兜底）；`jbrHome = join(studio, 'jbr')`，`bin/java.exe` 在场即 `jbrReady`。用户自装非默认目录的场景：本 plan 接受探测不到（jbr 走应用自管 JRE 兜底），注册表增强留 backlog。
6. **分支 4（PATH 反推）**：分隔符用 `path.delimiter`（Node 官方平台常量，darwin 为 `:` 行为不变）；候选 `join(dir, 'adb.exe')`；`looksLikeSdkRoot` 探测 `platform-tools/adb.exe`（平台函数）。
7. **大小写规范化**：`isStudioSdk`（`:246-262`）在 win32 下对两路径 `toLowerCase()` 后比较（分隔符由 join 产物保证统一）；直接相等短路保留。
8. **adb.ts 候选**：win32 候选插在 `:130` 的 mac Library 候选同级位置（候选链顺序：系统默认 → app-sdk → PATH），`.exe` 后缀由 `sdkPaths` 平台化后自动对齐（P1 交付）；探测 spawn 补 windowsHide。

## Build order

1. `Deps.platform` 接缝 + 各常量/形状函数平台化 + darwin 快照单测（现值钉住）。
2. win32 分支逐项落地 + 单测（固定目录探测、配置解析含 `$USER_HOME$` 展开与盘符正则、默认路径、PATH `;` 反推、mdfind 不被调用断言）。
3. `isStudioSdk` 大小写规范化 + 单测（win 大小写漂移判等、darwin 回归）。
4. `adb.ts` 候选链 + 单测（win 候选存在/缺失、顺序、darwin 回归）。
5. 全套回归 + typecheck/lint + 收尾（`sdkMigration.ts:296` 记 issue）。

## Test plan

- 单测：win32 四分支各至少正/反例；`LOCALAPPDATA` 缺省回退 homedir 拼接；大小写漂移判等；mdfind 兜底在 win 不触发；adb 候选链两平台顺序。
- 回归：studioDetect/adb 现有用例零改动全绿；全套 + typecheck/lint/prettier。
- 真机（延后到统一集成阶段）：真装 Android Studio 的机器跑 `sdk:detect-studio` 对照——`%APPDATA%\Google\AndroidStudio*` 配置文件字段形态回填用例；非默认安装位置确认探测不到时设置页共享选项禁用态符合预期。

## Done criteria

- 全套测试全绿且既有用例零改动；win32 分支单测齐；零注册表口径成立（代码中无 reg 调用）；`sdkMigration.ts` 探测问题已记 issue；调研报告 H 落地路径逐条对上；book 收尾完成。
