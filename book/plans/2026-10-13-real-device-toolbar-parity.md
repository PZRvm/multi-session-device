---
description: 真机工具条对齐——通用边框 + 六键（返回/主页/概览/音量±/旋转）+ 截屏/网络/日志三域真机适配（think-report 假设 5 推迟项提前执行，用户 2026-10-13 批复「全做」；电源键经用户裁定不做）；三域统一走 serialOfDeviceId 已验证的「外部表优先、miss 落 AVD」组合查询模式
status: completed
created: 2026-10-13
---

# 真机工具条对齐 + 截屏/网络/日志三域适配 — plan

> 2026-10-13 实施完成（S1—S5 五步独立提交，每步 typecheck/lint/test 全绿；分支
> feature/real-device-usb-and-apk-install）。对设计的两处实现偏差：①网络 hook 未按
> 「参数化状态源」改签名，改为**双源合并读**（externalStore ?? deviceStore，id 不相交
> 故安全）——两个画布调用点零改动，写回按 externalStore 成员路由；②日志 dock 的生命
> 周期跟随从「对象引用比较」改为**原始值 key 比较**（logTarget 是派生对象、引用每帧
> 新建，比引用会无限 setState）。硬件验收条目并入
> [issue 2026-10-13-真机硬件验收待执行](../notes/issue/2026-10/2026-10-13-真机硬件验收待执行.md)。

- **Phase 5 code review（2026-10-13，只记录不修）**：与第一批合并走查——总体 pass、
  无 P1，1 项 P2（取消退出后真机跟踪不恢复，main/index 退出序）+ 8 项 P3，
  [发现清单](../notes/issue/2026-10/2026-10-13-真机两批-review.md)。
- **review 修复批（用户批复「P2 和 P3 修复掉」，2026-10-13）**：九项全部清零，详见
  [处置记录](../notes/issue/2026-10/2026-10-13-真机两批-review.md)。本 plan 相关：
  P3-2（DeviceRuntimeView.origin 判别拆桶）、P3-3（externalStore 迟到写回守卫）、
  P3-4（externalDeviceNotReady 词条）、P3-5（ExternalCanvas 组件测试）。全量 1185 项通过。
- **Phase 5 增量 review 第二轮（2026-10-13，只记录不修）**：总体 pass，1 项 P2（真机
  投屏重试链路）+ 3 项 P3，[发现清单](../notes/issue/2026-10/2026-10-13-真机增量-review.md)。

批复：用户 2026-10-13「全做」+「电源键可以不用」+「真机需要在外加一个通用边框」。本 plan 即 [think-report 20261013013755](../notes/think-report/20261013013755-真机USB无线接入与APK拖装.md) 假设 5 推迟项（截屏/断网/日志三域）的提前执行——技术通路已被第一批的 serialOfDeviceId 模式验证：三域本质都是 `adb -s <serial>`，serial 对真机语义不变，缺的只是「第二通路」。

## Requirements brief — Step 0

### Background

ExternalCanvas 目前只有孤立的旋转按钮，无设备外框；截屏/网络/日志三域的注入点都断言 AVD 的 running 生命周期态，真机画布不可用。三域的命令链路（adb screencap / svc 开关 / logcat 流）与设备来源无关。

### Scope

- **Affects**：renderer（ExternalCanvas 边框与工具条、DeviceToolbar 电源钮可选化、useScreenshot/useNetworkSwitch 参数收窄、externalStore 增网络态、App 日志目标与网络推送路由）；main（queries 两个组合查询、external.ts 视图导出、ipc 装配三域注入点与 external 桥扩员）。
- **Does NOT affect**：电源键（用户裁定不做——scrcpy 按键闭集白名单不动）；模拟器侧行为（onPower 可选化对既有调用点零变化；hook 参数收窄为结构性满足，模拟器传整 Device 不改）；DeviceSnapshot/持久化/对账；三域内部逻辑（只动注入点与会话桥，不改域实现）。
- **Boundaries**：不新增 IPC 通道——network/screenshot/logcat 通道复用，id 键控天然区分真机（serial）与 AVD（uuid）；真机日志会话 runId 用 ext 代次。

### Requirement

| 约束 | 要求 |
| --- | --- |
| 六键 + 边框 | 返回/主页/概览/音量±/旋转在真机工具条可用；无电源钮；通用外框呈现 |
| 截屏 | 真机 capture → 剪贴板 → save 下载目录全链路；真机失联后气泡收起、save 拒绝 stale |
| 网络 | 三开关对真机可切换且 1s 读回；轮询随 connected 起、随 removed/失联收 |
| 日志 | dock 与独立窗均可用；独立窗设备下拉含已连接真机 |
| 门禁 | 每步 typecheck + lint + test 全绿，独立 commit |

## Design — Phase 2

### 1. 通用边框 + 六键工具条（renderer）

- **边框**：ExternalCanvas 补 frame-shell 渲染（同 DeviceCanvas 无皮肤分支）——layout 本就按 `'generic'` 档计算，补 shell div（圆角机身、`--device-shell` 底）即可；generic 档无听筒/前摄装饰（真机视频自带真刘海，画假听筒反而穿帮）。
- **工具条**：DeviceToolbar 的 `onPower`/`powerDisabled` 改可选——不传 onPower 则不渲染电源钮；模拟器调用点零变化。ExternalCanvas 复用整个 DeviceToolbar：`disabled={!ready \|\| rotating}`、onButton/onRotate 走既有 sendInput，截屏/网络组在 S3/S4 接入。

### 2. 组合查询与视图导出（main 基座）

- queries.ts 增两个组合查询（模式同 serialOfDeviceId）：
  - `deviceRefOfId(id): Promise<{ serial; name } | null>`——外部 `device` 态 → `{ serial, name: model ?? serial }`；miss → 落 `runningDeviceRef`（AVD 行为不变）。
  - `isDeviceActiveOfId(id): boolean`——外部 `device` 态 || `isRunningDevice(id)`（截屏尾段同步复核用）。
- external.ts 导出 `externalRuntimeViews(): DeviceRuntimeView[]`——`device` 态真机映射 `{ id, name, status: 'running', serial }`（status 适配：已连接 ≡ running 语义；runId 省略，日志订阅可惰性建会）。

### 3. 截屏域

- ipc 装配：`registerScreenshotIpc` 注入换 `runningDevice: deviceRefOfId`、`isRunningDevice: isDeviceActiveOfId`。
- renderer：`useScreenshot` 参数收窄为 `Pick<Device, 'id' | 'status'>`（现只用 id 与 running 门控）；ExternalCanvas 以 `{ id, status: state === 'device' ? 'running' : 'stopped' }` 适配——失联时气泡收起，同模拟器停止语义。

### 4. 网络域

- ipc 装配：`registerNetworkIpc` 的 `runningDevice` → `deviceRefOfId`；external 桥 connected → `network.startWatch(id, serial)`、removed → `network.clearWatch(id)`（与 scrcpy 并列）。
- renderer：externalStore 增 `network: Record<string, NetworkState>` 与 applyNetwork——**不能放 deviceStore**（其 network 随 AVD 快照 prune，外部键会被清）；App 的 network onChanged/getAll 按 id 分流（externalStore 命中走 external，否则 deviceStore）。`useNetworkSwitch` 参数化（deviceId + 状态源），不再硬绑 deviceStore；模拟器调用点一行同步。

### 5. 日志域

- ipc 装配：external 桥 connected → `logcat.ensureSession({ id, runId: event.runId, serial })`、removed → `logcat.destroySession(id)`；logcat manager 的 `runtimeViews` 注入换合并视图 `() => [...listDeviceRuntimeViews(), ...externalRuntimeViews()]`——订阅惰性建会（[logcat/index.ts](../../src/main/logcat/index.ts) 的 runningDeviceOf）与独立窗下拉同时受益。
- renderer App：日志目标改 `{ id, runId?: string }` 形态——真机选中且 `device` 态 → `{ id }`；dock/独立窗/贴回/窄窗拉宽逻辑按目标键控，AVD 分支行为不变；LogcatPanel key 用 id。

### 6. 测试布局

- main：queries 组合查询三分支（external 就绪/未就绪/AVD）；externalRuntimeViews 映射（只列 device 态）；external 桥事件序列扩展（onSession 消费方在装配层，单测以事件为准）。
- renderer：externalStore.network 语义；App 网络推送分流；ExternalCanvas 工具条渲染（六键在、电源钮不在、边框在）；useScreenshot/useNetworkSwitch 收窄后的既有测试回归。

## 实施顺序（每步全绿门禁 + 独立 commit）

1. **S1 边框 + 六键**：ExternalCanvas shell + DeviceToolbar 可选化 + 工具条接入（截屏/网络组暂不传）。
2. **S2 main 基座**：queries 两组合查询 + externalRuntimeViews 导出 + 测试。
3. **S3 截屏**：注入点换血 + hook 收窄 + ExternalCanvas 接截屏组。
4. **S4 网络**：注入点 + external 桥挂 watch + externalStore.network + App 分流 + hook 参数化 + 工具条网络组。
5. **S5 日志**：external 桥挂会话 + 合并视图 + App 日志目标真机分支。
6. **S6 收尾**：stage06 结果行追加、learn 补条、issue 更新（假设 5 三域提前完成）、`npm run book:index`。

## 验收清单（真机在手）

- 六键与旋转全部生效；无电源钮；通用外框与画面贴合。
- 截屏：入剪贴板、气泡缩略图、保存下载目录；拔线后气泡收起、save 拒绝。
- 网络：三开关切换后 1s 内读回正确；拔线后轮询停、开关禁用。
- 日志：dock 订阅/过滤/暂停；弹出独立窗、设备下拉含真机并可切换；拔线后输出停。
- 模拟器全量回归不变（测试门禁 + 工具条/截屏/网络/日志手工抽测）。

## 风险与兜底

- **deviceStore.network 的 prune 会清外部键** → 外部网络态独立存 externalStore（已设计）；App 分流以 externalStore 成员为准。
- **日志惰性建会依赖合并视图** → externalRuntimeViews 只列 `device` 态；未授权真机订阅报 logcatDeviceNotRunning（文案略偏但语义正确，记 issue 可后补词条）。
- **useNetworkSwitch 重构触碰模拟器调用点** → 类型驱动，编译期暴露不一致。
- **真机日志会话与投屏会话共用 ext 代次 runId** → 拔线时两域同桥销毁，无先后依赖。
