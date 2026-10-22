---
description: P2 Windows 检测链（4dc8d46）代码评审发现——4 项 P3：平台传参风格、APPDATA 未优先读 env、win 用例 runner 可携带性、isStudioSdk 遗留未用声明；只记录未修
created: 2026-10-22
status: open
tags: [review, windows, studio-detect, p3]
---

# Windows 检测链分支 code review（P2，commit 4dc8d46）

阶段 5 评审，纪律**只记录不修**——修复是后续独立批次（参考 download-cancel 的 review 修复轮先例）。

## 核对通过项（先说结论）

- **mac 零变化成立**：darwin 路径的 diff 仅为「移进 else 分支」的缩进变化，逻辑逐行未动；既有用例零改动、全套 1325 过。
- win32 四条候选链、固定目录探测、jbr 布局、大小写比较均有注入 `platform` 的单测背书；mdfind 在 win 不可达有显式断言。
- `defaultAdbOnPath` 接缝修复（优先注入 fileExists）默认行为不变，且补上了「测默认实现」用例。
- 类型/命名/注释密度对齐仓库风格；typecheck/lint/prettier 全过。

## 发现（全部 P3）

### P3-1 分支 4 平台传参绕

`detectStudioAndSdk` 分支 4 传 `platform: isWin ? 'win32' : undefined` 给 `defaultAdbOnPath`，而后者只判 `deps.platform === 'win32'`——直传 `deps.platform` 语义等价且更净（非 win32 平台值也能正确落到 posix 分隔符行为）。一行修。

### P3-2 configRoot / defaultSdkPath 未优先读 env，与 adb.ts 口径不一致

win32 的 configRoot（`AppData\Roaming`）与 defaultSdkPath（`AppData\Local`）都从 homedir 推导；而 `adb.ts` 的标准候选**读了** `env.LOCALAPPDATA`。企业漫游配置/OneDrive 重定向 AppData 的机器上，本模块会漏分支 1 与分支 3 的最优候选（下游 env/PATH 分支兜底，属降级不破坏）。修法：两处构造先读 `env.APPDATA` / `env.LOCALAPPDATA`，缺省再按 homedir 推——与 adb.ts 对齐。

### P3-3 两条 win 用例的断言依赖 posix runner 行为

「正斜杠配置值」（`toBe('C:/sdks/android')`）与「PATH 反推」（`toBe('C:/sdkroot')`）两条用例的期望值是 posix runner 上 `normalize` 无操作、正斜杠 `dirname` 的产物；若未来在真实 Windows 上跑 vitest，`normalize` 会转反斜杠导致断言失败。当前仓库只在 mac 跑测试（假设 3 既定），属前瞻备注。修法：期望值同经 `normalize()` 构造。

### P3-4 isStudioSdk 遗留未用的 fileExists 声明（先于本分支存在）

`isStudioSdk` 的 deps 自始声明 `fileExists` 却从未使用（本分支只是把 `'platform'` 加进同一个 Pick）。非本提交引入，顺手记录；下个动到该函数的批次可清掉。

## 处置建议

四项均不阻塞合并——P3-1/P3-2 可并入下次触碰 studioDetect 的批次（P5/P6 或 review 修复轮）；P3-3 建议与「Windows 上跑单测」的集成收口阶段同批；P3-4 同上。
