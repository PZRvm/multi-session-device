---
description: 日志面板设计：右侧可拖宽 dock + 独立日志窗、主进程会话与环形缓冲、批量+ack 流控与多窗口订阅
status: completed
created: 2026-10-10
completed: 2026-10-10
---

# 日志面板 — plan

设计（Step 0 / Phase 1 / Phase 2）与实现（Phase 3–6）均已完成。位置与形态沿用 2026-10-10 与用户定下的方向：主窗右侧可拖宽 dock，可切换为独立日志窗；日志会话与环形缓冲归主进程持有，任意窗口按设备订阅。实现细节与设计的出入见文末「实施结果」。

依据：[stage05](../stage/05-功能完善.md) 步骤「日志面板」、[workflow](../guidelines/workflow.md) 前三阶段、[PRD](../docs/PRD.md) 一期成功标准。

## Requirements brief — Step 0

### Background

测试人员在设备上复现问题时需要实时查看 logcat 定位故障。现有应用只有投屏与操控，没有任何日志能力。设备为竖屏手机造型，画布水平两侧留白多、纵向空间稀缺——这决定了面板放右侧而不是底部。

### Scope

- Affects：主窗第三栏（右侧 dock，可拖宽）、独立日志窗（第四 HTML 入口）、主进程日志会话域（`adb logcat` 进程管理 + 环形缓冲 + 推送）、IPC 通道与类型、主窗 App 布局、i18n 词条。
- Does NOT affect：投屏域内部（scrcpy 模块零改动，只在生命周期桥处并行挂钩）、导出与按 app 过滤（stage 明确一期不做）、日志着色与 tag/pid 结构化过滤、正则过滤、设备启停逻辑、设置窗、向导窗、剪贴板、录屏。
- Boundaries：日志只读，不向设备发送任何输入；会话生命周期只跟设备 running 状态走，与窗口开关无关；dock 宽度为窗口内瞬态（本批不落盘，持久化另议）。

### Requirement

| 能力 | 要求 | 一期边界 |
| --- | --- | --- |
| 实时流 | 设备 running 即有会话；面板打开即订阅，晚开可看到环形缓冲里的近期行 | 订阅回放最近 500 行（初始值），更早的不滚动加载 |
| 关键字过滤 | 大小写不敏感子串匹配，作用于已渲染行 | 不做正则、tag、pid、级别过滤；过滤不回溯环形缓冲全量 |
| 暂停/继续 | 暂停只是视图停止追加渲染；主进程缓冲持续更新 | 继续后从最新行接入，不回放暂停期间的行（防巨量补渲染） |
| dock 拖宽 | 拖右缘调宽 240–560px，默认 320px，复用 ResizeHandle 交互 | 宽度本次会话内记住，不落盘 |
| 独立窗口 | 非模态、无 parent、sandbox、单例；带 running 设备下拉；关窗=退订，不停会话 | 一期单例一个日志窗；不做多日志窗各看各设备 |
| 窄窗退化 | 画布可用宽度不足时 dock 收起为按钮，点击直接开独立窗口 | 阈值初始 720px（画布区可用宽），可调 |
| 行容量 | 主进程环形缓冲每设备 5000 行（初始值），seq 单调递增 | renderer 渲染上限同步裁剪，超限丢最旧行 |

设计轴：

- [recommended — confirm or reject] dock 弹出为独立窗时行视图连续：会话与缓冲在主进程，切窗不丢行、不断流。
- [recommended — confirm or reject] 日志推送允许丢最旧保最新（与投屏「不可丢帧」相反）：洪泛时丢旧行并在视图标记「已省略 N 行」。
- [recommended — confirm or reject] 拖宽交互与视觉复用左栏 ResizeHandle 先例；右缘把手镜像。
- [recommended — confirm or reject] 独立窗建窗模式镜像设置窗先例：单例、加载互斥、超时、主窗关闭联动、sandbox 为 true。
- [recommended — confirm or reject] 暂停期间 renderer 不存行；「清空」只清视图，不清主进程缓冲。

## Impact range — Phase 1

### 现状与可复用项

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `src/main/ipc/index.ts` `attachDeviceStreamBridge` | runner 事件 → 投屏会话生命周期的现成接缝（running/stopped/beforeKill） | 日志会话挂同一组事件，与投屏并行，不改投屏行为 |
| `src/main/scrcpy/index.ts` outbox/ack/lastAckAt | 投屏已有批量推送 + ack 流控全套 | 日志推送镜像该思路，但改为可丢最旧（见设计轴） |
| `src/renderer/src/App.tsx` + `ResizeHandle.tsx` | 左栏 listWidth 拖宽先例；canvas-area 为 flex 主区 | 右栏对称实现：canvas-area 右侧加 handle + logPane；画布内设备框居中自适应自动吸收剩余宽度 |
| `src/main/window/settings.ts`、`wizard.ts` | 独立窗单例、加载互斥、15 秒超时、主窗关闭联动、sandbox true | 日志窗照抄该模式，第四 HTML 入口 |
| `electron.vite.config.ts` | 已有三个 renderer 入口 | 增加 `logcat` 入口，dev/prod 同步接线 |
| `src/shared/types.ts` 242-245 | 设备 record 在 starting/running 发布 `serial`、`runId`，停止清空 | 会话键用 deviceId + runId；serial 变化即重建会话 |
| `src/shared/ipc-channels.ts`、`src/preload/api/` | 通道名单源 + preload 白名单域文件 | 新增 logcat 域通道与 api 文件，append-only |
| `src/main/devices/index.ts:181` | `adbBinaryPath` / `androidToolEnv` 已导出（scrcpy 同款消费方式） | 日志域 import 消费，不改 devices 域 |
| `src/shared/i18n/` | mainWindow / errors 双域，errors 按「词条 + 原始 stderr 附详情」惯例 | 新增词条两处 append |

影响图：

```text
runner 事件 (running / stopped / beforeKill / before-quit)
    |
    v
logcat 域: ensureSession(spawn adb -s <serial> logcat) / destroySession(kill)
    |
    v
行流 UTF-8 解码 --> 环形缓冲(每设备 5000 行, seq 递增)
    |
    v  订阅表(按 webContents × deviceId)
批量推送 logcatBatch(250ms 或 200 行 flush) --> [主窗 dock LogcatPanel] + [独立日志窗]
    ^                                              |
    +------------- logcatAck(积压超限丢最旧) <------+
```

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| `adb logcat` 进程泄漏（设备停止、应用退出时未回收） | beforeKill 先杀进程再停模拟器；`shutdownStreams` 扫尾接缝扩展为投屏+日志两域；kill 后兜底 SIGKILL |
| 日志洪泛（verbose 应用每秒数百行）打爆 IPC | 批量推送（250ms 或 200 行触发 flush）+ ack 窗口；未 ack 积压超过 2000 行丢最旧并推送「已省略 N 行」标记 |
| 暂停导致 renderer 内存无界增长 | 暂停期间 renderer 不存行；继续后从缓冲尾接入，天然有界 |
| 多窗口重复订阅同一设备 | 订阅表按 webContents 维度登记；窗口 closed 事件自动清理；发送前检查 `webContents.isDestroyed()` |
| 设备重启（runId 变化）后旧会话残留 | 会话键含 runId，running 事件带新 runId 即重建；旧缓冲丢弃 |
| 中文输出乱码 | 按 UTF-8 解码，坏字节替换字符处理，单行损坏不中断流 |
| 独立窗与 dock 同时显示造成困惑 | 开独立窗时主窗 dock 自动收起（主窗本地状态）；独立窗单例 |
| dock 拖宽挤压设备框 | 设备框在剩余区域居中自适应（现有布局行为），窄于阈值整栏退化 |
| 主进程缓冲 5000 行 × 多设备的内存 | 行文本截断单行 4000 字符；每设备约 2MB 上限，一期接受，不落盘 |

## Design — Phase 2

### 1. 数据流与 IPC

通道常量（`src/shared/ipc-channels.ts` append）：

| 通道 | 方向 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `logcatSubscribe` | renderer → main | `{ deviceId }` | 登记（先订阅后回放）；设备未 running 返回错误结果 |
| `logcatUnsubscribe` | renderer → main | `{ deviceId }` | 退订单设备；关窗由 main 侧 closed 钩子统一清理 |
| `logcatBatch` | main → 窗口 | `{ deviceId, runId, lines: Array<{ seq, text }>, dropped?: number }` | 回放与实时同通道；`dropped` 为流控丢弃标记 |
| `logcatAck` | 窗口 → main | `{ deviceId, upToSeq }` | 流控回执，镜像 screenAck |
| `logcatWindowOpen` / `logcatWindowClose` | 主窗 → main | 无 | 建窗/关窗白名单桥，镜像 settingsOpen/Close 守卫 |

类型（`src/shared/types.ts` append）：`LogcatLine { seq: number; text: string }`、`LogcatBatchMessage`、`LogcatAckMessage`。时间戳与 tag 不解析——原文整行进缓冲，过滤与显示都在 renderer。

会话模块 `src/main/logcat/index.ts`：

- `createLogcatManager({ adbPath, toolEnv })`，导出 `ensureSession({ id, runId, serial })`、`destroySession(id)`、`destroyAll()`、`registerIpc({ isSubscriber })`、`attachLifecycle(bridge)`。
- spawn `adb -s <serial> logcat`（不加过滤参数），stdout 按行切分、UTF-8 解码、单行截 4000 字符入环形缓冲。
- 推送：每设备 flush 定时器 250ms 或攒满 200 行即发；订阅表 `Map<webContentsId, Set<deviceId>>`；积压（已发未 ack）超 2000 行丢最旧并计数。
- 订阅回放：登记时先推缓冲尾 500 行（首包标记），随后接实时。

与投屏的差别（刻意为之）：screen 域仅登记主窗、不可丢包；logcat 域任意窗口可订阅、可丢最旧保最新。两条差异都写进通道注释。

### 2. renderer：dock 与独立窗

主窗 `App.tsx` 布局变化：

```text
┌──────┬──────────────────────┬│─────────────┐
│ 设备  │                      ││ 日志  ⏸ ↗ ✕ │   ─┐
│ 列表  │      模拟器画面        ││ [关键字过滤]  │    │ ResizeHandle
│      │   （居中自适应吸收宽度） ││ log 行...    │    │ 拖宽 240-560
│ 新建  │      [物理键工具条]    ││             │   ─┘
└──────┴──────────────────────┴┴─────────────┘
```

- `LogcatPanel.tsx`（新组件，dock 与独立窗共用）：工具条（过滤输入框、暂停/继续、清空视图、弹出/收起按钮）+ mono 行列表；过滤即时重算已渲染行；行数上限 5000，超限裁剪最旧。
- dock 收展状态与宽度是主窗瞬态 state；「↗」弹独立窗（dock 随之收起），独立窗关闭后主窗恢复按钮入口。
- 窄窗（画布可用宽 < 720px）：dock 不可展开，入口按钮直接开独立窗。

独立日志窗：

- `src/renderer/logcat.html` + `src/renderer/src/logcat/LogcatApp.tsx`，第四 HTML 入口；默认 560×640、最小 400×360，可调尺寸。
- 窗头沿用独立窗先例（原生三灯 + 40px 拖拽带），内嵌 running 设备下拉 + 同一个 `LogcatPanel`。
- 建窗桥 `logcatWindowOpen/Close` 走 settings 同款守卫：单例、加载互斥、超时释放、主窗关闭联动关闭。
- 关窗只退订；切设备即退订旧设备订阅新设备。

### 3. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/main/logcat/index.ts`（+ `__tests__/`） | 会话管理、环形缓冲、批量+ack 流控、订阅表、生命周期挂钩 |
| `src/main/ipc/index.ts` | 注册 logcat 域；`attachDeviceStreamBridge` 处并行挂 ensure/destroy；`shutdownStreams` 扩展 |
| `src/main/window/logcat.ts`（+ 测试） | 日志窗单例与守卫，镜像 settings 先例 |
| `src/main/window/index.ts` | 主窗关闭联动 |
| `electron.vite.config.ts` | 第四入口 `logcat` |
| `src/renderer/logcat.html`、`src/renderer/src/logcat/index.tsx`、`LogcatApp.tsx` | 独立窗入口装配 |
| `src/renderer/src/components/LogcatPanel.tsx`（+ 测试） | 共用面板：过滤/暂停/清空/弹出、行列表 |
| `src/renderer/src/App.tsx`（+ 测试） | 右栏 + ResizeHandle 镜像、收展与窄窗退化 |
| `src/shared/ipc-channels.ts`、`src/shared/types.ts` | logcat 域通道与消息类型 append |
| `src/preload/api/logcat.ts`、`api/index.ts`、`index.d.ts` | 白名单桥 append |
| `src/shared/i18n/mainWindow.ts`、`errors.ts` | 面板词条与错误词条 append |

i18n 初始键（mainWindow 域）：`logcatTitle`、`logcatFilterPlaceholder`、`logcatPause`、`logcatResume`、`logcatClear`、`logcatPopOut`、`logcatEmpty`、`logcatDroppedLines`、`logcatNoDevice`、`logcatDeviceLabel`；（errors 域）：`logcatDeviceNotRunning`、`logcatStartFailed`。

## Done criteria — 设计阶段

需求与排除项填实；影响图与风险有代码证据；通道/类型/文件清单可直接进 Phase 3；三个「与投屏域的刻意差异」（多窗订阅、可丢最旧、无回放滚动加载）已在类型注释与本文写明；stage05 步骤挂本 plan 链接；book 索引构建通过。

实现阶段终点（Phase 3-6）：真机验证实时流、过滤、暂停/继续、拖宽、弹窗切窗不丢行、设备停止后会话回收、退出无残留进程。——已达成，见下。

## 实施结果 — 2026-10-10

### Phase 3：实现

与设计的主要出入（其余按设计落地）：

- **订阅回放不补发 pending**：设计阶段曾考虑「回放后补发攒批行」，实现确认同步流程无间隙可补（pending 行已在环形缓冲），改为订阅前先 `flushNow` 给既有订阅者、回放即缓冲尾——避免回放与 flush 重复。
- **ResizeHandle 泛化 `edge` 属性**：右栏把手方向反转（向左拖变宽）、键盘步进随之镜像；`listWidth.ts` 先例复制为 `logPaneWidth.ts`（240–560）。
- **窄窗退化用纯派生而非 effect 收起**：`dockVisible = logDockOpen && 画布余量 ≥ 720`，窗口收窄即时隐藏、回宽恢复，不落额外 state（react-hooks v6 `set-state-in-effect` 规则下也更干净）。
- **设备换代（runId 变化）时 renderer 以 `key={deviceId:runId}` 重挂**面板完成重订；主进程侧订阅随旧会话销毁，不自动迁移。
- **日志窗上下文**：`logcat:context` 通道返回完整设备快照（`devices:list` 对非主窗有守卫），下拉数据源独立于 devices 域；弹出时经 URL `?device=` 传入 dock 当前设备。
- **暂停期间批次照常 ack**（设计未言明）：不确认会让 main 侧积压丢行，暂停是纯视图行为。
- **用户反馈迭代（同日）**：dock 改为默认固定展开（`logDockOpen` 初值 true），配套主窗默认宽 900→1200、画布保底 720→560，默认尺寸即呈三栏；独立日志窗 darwin 三灯安全区 64→80px（hiddenInset 灯组右缘约 66px，64px 起步的下拉框与之重叠）。窗口级截图核验两处修复。
- **用户反馈迭代（同日，第二批）**：dock 改回默认收起且不持久化开合状态（每启从收起起步）；独立窗 head 区 darwin 下接管拖拽（`-webkit-app-region: drag`，select/贴回按钮 no-drag——hiddenInset 无系统标题栏，此前窗口不可拖）；新增「贴回」闭环（独立窗 header 右端按钮 → `logcat:dock-back` → main 关日志窗并广播主窗重新展开 dock）；主窗入口点击先查 `logcat:window-state`，独立窗开着即聚焦（单例 focus）而非重开 dock。真机验证 10/10（合成拖拽需辅助功能权限未自动化，拖动由 app-region 机制保证、留用户确认）。
- **用户反馈迭代（同日，第三批）**：dock 展开时窗口缩窄不再隐藏 dock——新增 `logcat:dock-state` 通道，展开时 main 锁主窗 `setMinimumSize`（列表+分隔条+日志栏+画布保底的实际值），收起/弹出解锁；窄窗点入口不再退化独立窗，改为 main 自动拉宽窗口让 dock 黏滞右侧（独立窗只经面板内「弹出」产生）；列表与日志栏拖宽把手加动态上限（dock 展开时拖不到挤爆画布的宽度）。真机验证：renderer 通路触发 main 拉宽（1400→2000 实测）、够宽不动作；minWidth 锁定行为由 setMinimumSize 语义保证（合成拖拽无法自动化），留用户确认。
- **用户反馈迭代（同日，第四批）**：minWidth 锁定改声明式跟随——effect 以 `dockVisible` 为源同步 `dock-state`（可见锁、不可见解锁），`dockNeedWidth` 随拖宽自动跟随重锁；收起/弹出简化为纯 `setLogDockOpen(false)`，解锁由 effect 统一保证。独立窗口态主窗宽度完全自由；贴回窄窗按需拉宽（与入口展开共用 expandDock 通路），新增窄窗贴回与弹出解锁两组单测断言。882 项测试通过（6 项原有跳过），typecheck/lint/build 通过。

### Phase 4：验证

- 全量测试 878 通过、6 项原有跳过；本批新增 main logcat 域 11 项 + LogcatPanel 10 项 + App dock 集成 6 项。typecheck、lint、build 通过。
- 真机验证（构建产物 + CDP 驱动，真实启动 Pixel 8 API 32 模拟器）18/18 通过：宽窗 dock 展开收行（1296 行）、默认 320px、关键字过滤、暂停视图停更、恢复断点标记、窄窗隐藏/回宽恢复、窄窗点击开独立窗且 dock 收起、独立窗对准目标设备并持续收行、独立过滤、设备停止后退空态、`adb logcat` 进程零残留。

### Phase 5：review

自审发现并修复一处 P1：会话销毁原先按 deviceId 裁决，设备快速换代（runId 变化）时旧进程的迟到 exit 回调会误杀新会话——已改为按会话身份裁决（`destroySessionOf`），补回归测试「旧进程 exit 迟到不误杀换代后的新会话」。另发现 spawn 同步失败时保留空会话、订阅者只见空态无错误提示，按 workflow 记 [issue](../notes/issue/2026-10/2026-10-10-logcat-spawn-fail-silent.md)，不在本批修复。

### Phase 6：文档与记录

- stage05 步骤「日志面板」勾选完成（一期边界：不做导出与按 app 过滤）。
- 记录 [format 脚本参数陷阱与 Electron 直启 userData 隔离](../notes/learn/2026-10/2026-10-10-logcat-verify-pitfalls.md)。
- 本 plan 状态翻 completed。
