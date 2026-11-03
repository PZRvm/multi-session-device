---
description: 断网开关组：工具条并排三开关——飞行模式总开关（真断网）+ Wi-Fi/移动数据分 radio（场景测试）；1s 轮询读回、变化才推、设备为唯一事实源
status: completed
created: 2026-10-12
---

# 断网开关组（飞行模式 + Wi-Fi + 移动数据）— plan

设计阶段（Step 0 / Phase 1 / Phase 2）完成，实现未开始。调研与两轮真机实测见 [think-report 20261012031543](../notes/think-report/20261012031543-断网开关.md)；用户 2026-10-12 批复：①开关放工具条 ②轮询定案、间隔 1s ③分 radio（Wi-Fi/数据）纳入本功能 ④三开关并排工具条形态。PRD 80 行实现批补一句分 radio 口径。

依据：[stage05](../notes/summary/2026-10/2026-10-16-功能完善.md) 步骤「断网开关」、[workflow](../guidelines/workflow.md) 前三阶段。

## Requirements brief — Step 0

### Background

测试人员要对运行中设备做网络边界测试：一键真断网（飞行模式）与网络场景切换（单 Wi-Fi / 单蜂窝）。实测关键语义（think-report 第二轮）：模拟器蜂窝真实路由，**单关任一 radio 不断网**（另一路接管），飞行模式或双关才真断网——总开关与分开关的产品定位由此定。开关状态以设备为唯一事实源：设备内（快速设置磁贴、Internet 面板、设置页）手动切换任一项，应用侧 ≤1s 跟随；应用下发也以读回为准，不做本地乐观态。

### Scope

- Affects：`DeviceToolbar`（并排三开关组）、`deviceStore`（网络态切片）、主进程网络域 `src/main/network/`（命令下发 + 1s 轮询读回 + 变化推送 + 生命周期启停）、IPC 通道与类型、preload 桥、i18n 三语词条、PRD 80 行一句扩容。
- Does NOT affect：录屏（stage05 同步骤另一半，另批）、蜂窝精细整形（网络类型/信号/漫游，PRD 二期）、连通性探测（不做 ping/在线状态显示，不承诺「关 radio 后网络立即可用/不可用」）、设置窗、向导窗、logcat/scrcpy 域、APK 安装域、设备列表行 UI。
- Boundaries：仅对 running（serial 已发布）设备可用，未 running 三开关禁用（不猜状态）；网络态不落应用持久层——每次以设备读回为准（设备重启残留态如实显示）；开关组仅主窗工具条。

### Requirement

| 能力 | 要求 | 一期边界 |
| --- | --- | --- |
| 断网总开关 | 点击 → `cmd connectivity airplane-mode enable\|disable` → 立即读回推送 → 设备快速设置/状态栏同步亮灭，ping 真断/真恢复 | 点击至读回确认期间 busy；连点互斥 |
| Wi-Fi / 数据开关 | `svc wifi\|data enable\|disable`，同上读回确认 | 飞行模式开启时仍可点（意愿排队语义，系统托管，实测） |
| 状态同步 | 1s 轮询合并读三值，变化才推主窗；设备内手动切换 ≤1s 跟随 | 在途不叠发；读失败本轮放弃保留旧值 |
| 错误反馈 | 设备未运行 / 命令失败给词条 + stderr 附详情 | 沿 errors 域「词条 + 原文附详情」惯例 |

设计轴（均已批复，见 think-report 第 4 节）：

- [approved 2026-10-12] 三开关并排工具条：断网总开关 + Wi-Fi + 移动数据小开关，同排相机按钮后的工具键区。
- [approved 2026-10-12] 轮询而非监听：adb 无订阅通道，logcat 无飞行模式锚点行（实测），装接收 app 违背零侵入；1s 间隔，单发 20ms。
- [approved 2026-10-12] 设备为唯一事实源：下发后以读回推送，不本地记态；恢复语义（飞行模式前后 radio 状态）系统托管，应用不建模。
- [recommended] 轮询读合并单次 spawn：`settings get global airplane_mode_on; settings get global wifi_on; settings get global mobile_data` 一发三行，替代 `cmd connectivity` 查询形态（读回等价，实测均同步于设备内切换）。

## Impact range — Phase 1

### 现状与可复用项

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `src/main/emulator/adb.ts:143` | `runAdb(adbPath, args)` 文本执行，默认 10s 超时 | 三组命令输出均为短文本，直接消费；不需要截图域 Buffer 版 |
| `src/main/ipc/index.ts:82-98` | `attachDeviceStreamBridge({ running(id, runId, serial), stopped(id), beforeKill(id) })`——running 回调直接给 serial，stopped/beforeKill 是截屏缓存清理挂点 | 轮询器启停同桥：`running` 启动（serial 免二次查询）、`stopped`/`beforeKill` 退订清理；网络域无进程不进 `streamShutdown` |
| `src/main/ipc/index.ts:49-54` | 截屏域注入模式：`{ adbPath, runningDevice, isRunningDevice, isMainSender }` | 网络域同款注入，域不反向依赖 devices |
| `src/main/screenshot/index.ts:144` | `captures` Set 同步占位互斥（检查与 add 之间零 await） | `networkSet` 同款每设备互斥 |
| `src/main/devices/index.ts:770` | `devicesChanged` 全量快照广播 | **不搭车**——网络态走独立轻量通道，不触发全量 snapshot 与对账 |
| `src/renderer/src/components/DeviceToolbar.tsx` | 物理键数组式渲染 + rotate/相机工具键先例 | 三开关 append 进工具键区，busy/disabled/aria-label 同款 |
| `src/shared/ipc-channels.ts:110-117` | 截屏/APK 域通道注释式登记 | 网络域同格式 append |
| `src/preload/api/screenshot.ts` | 独立 api 文件 + `index.d.ts` 同步 | `api/network.ts` 同款 |

影响图：

```text
DeviceToolbar [✈][Wi-Fi][▮▮] --toggle--> preload networkApi.set(deviceId, target, enabled)
    ^                                         |
    |                                         v
    |                            main 网络域: 互斥占位 → running 校验 →
    |                              按目标分发 adb 命令 → 合并读回三值
    |                                         |
    |                              值变化 → networkChanged 推主窗
    |                                         v
    +---- deviceStore.network[deviceId] <----+
              ^
              |
设备内手动切换 ──> 1s 轮询（合并单发 settings get ×3）──> 变化才推 ──┘
                     启动: attachDeviceStreamBridge.running(serial)
                     退订: stopped / beforeKill
```

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| 轮询开销（用户问过「会不会卡」） | 实测单发 20ms；1s 间隔单设备占空比约 2%，主进程异步、变化才推送（稳态零 IPC 零渲染）；并行上限内无感 |
| `wifi_on` 瞬态值 `2`（飞行模式下推 enable 后实测出现） | 解析映射：`0`→off，非 `0`（含 `2`）→on |
| 读失败（设备重启中、adb 闪断、shell 偶发慢） | 该轮放弃：保留旧值不推不告警，下轮再试；在途不叠发防堆积 |
| 用户快速连点与轮询竞态 | 每设备互斥（同步占位）+ 下发后读回为准；busy 至读回确认 |
| 飞行模式下点 radio 开关（意愿排队） | 实测系统托管：飞行关闭后按意愿恢复；UI 不禁用、显示设备真实读回态 |
| wifi-adb（tcpip）真机开飞行切断自身通道 | 一期模拟器（虚拟总线）无此问题；PRD/真机接入时标注仅 USB 连接可用 |
| 应用与设备状态脱节（重启残留、设备内切换、恢复语义） | 全部由「以读回为准」消解：启动读初值 + 轮询跟随，应用不自建状态机 |

## Design — Phase 2

### 1. 通道与接口

通道常量（`src/shared/ipc-channels.ts` append）：

| 通道 | 方向 | 载荷 / 返回 | 说明 |
| --- | --- | --- | --- |
| `networkSet` | renderer → main（仅主窗） | `{ deviceId, target: 'airplane' \| 'wifi' \| 'data', enabled: boolean }` → `ApiResult<{ state: NetworkState }>` | 下发命令后立即合并读回，以读回值返回；失败抛词条 |
| `networkChanged` | main → 主窗 | `{ deviceId, state: NetworkState }` | 轮询或下发读回发现值变化才推 |

类型（`src/shared/types.ts` append）：`NetworkTarget`（联合类型）、`NetworkState { airplane: boolean; wifi: boolean; data: boolean }`、`NetworkSetResult`。

### 2. 命令与读回解析（实测定案，think-report 2.3/2.4）

| 目标 | 下发命令（`runAdb` args） | 读回（合并单发） |
| --- | --- | --- |
| airplane | `['-s', serial, 'shell', 'cmd connectivity airplane-mode enable\|disable']` | `settings get global airplane_mode_on` |
| wifi | `['-s', serial, 'shell', 'svc wifi enable\|disable']` | `settings get global wifi_on` |
| data | `['-s', serial, 'shell', 'svc data enable\|disable']` | `settings get global mobile_data` |

合并读：`['-s', serial, 'shell', 'settings get global airplane_mode_on; settings get global wifi_on; settings get global mobile_data']` → 三行输出按序解析：`1`→true、`0`→false、`2`（仅 wifi 瞬态）→true；行数不足/exit 非 0/垃圾值 → 本轮放弃。

### 3. 主进程网络域 `src/main/network/index.ts`

- `registerNetworkIpc({ adbPath, runningDevice, isRunningDevice, isMainSender })`——注入同截屏域。
- `networkSet`：payload 校验 → 同步互斥占位（`Set<deviceId>`，镜像 `captures`）→ `runningDevice` 校验 → 分发命令（exit 非 0 抛 `networkCommandFailed` + stderr 详情）→ 合并读回 → 与 last 比较变化才推 `networkChanged` → 返回 `{ state }`；finally 释放互斥。
- 轮询器：`Map<deviceId, { timer, inFlight, last: NetworkState | null }>`；`startNetworkWatch(deviceId, serial)` 启动（1s 间隔，首拍立即执行——启动即得初值）；回调内 `inFlight` 守卫（上轮未返回跳过）；读成功且与 last 不同 → 更新 last 并推；`clearNetworkWatch(deviceId)` 清 timer 删条目。
- 生命周期接线（`src/main/ipc/index.ts` 82–98 桥内 append）：`running: (id, runId, serial) => startNetworkWatch(id, serial)`；`stopped` / `beforeKill` 内 `clearNetworkWatch(id)`（与 `clearScreenshotCache` 并排）。

### 4. renderer：三开关组

```text
[←][⌂][▢][⏻][🔈][🔉]  [↻] [📷] [✈][📶][▮▮]
 ─── 物理键 ───         工具键  └─ 网络开关组（并排）
 ✈ 断网（飞行模式）总开关 · 📶 Wi-Fi · ▮▮ 移动数据
 态来自 deviceStore.network[deviceId]；busy/未 running 禁用
```

- `deviceStore`：`network: Record<deviceId, NetworkState>` 切片，`networkChanged` 直写；设备移除时清理对应键。
- `useNetworkSwitch.ts`（新 hook）：`{ state, busyTarget, toggle(target) }`——toggle 调 `networkApi.set`，busyTarget 至读回返回；失败走既有 toast/alert 通路。
- `DeviceToolbar.tsx`：工具键区 append 三开关（lucide `Plane` / `Wifi` / `SignalCellular` 之类图标，Phase 3 选定）；受控态、busy 禁用、未 running 禁用、aria-label 带当前态；断网总开关视觉权重大于两个 radio 开关——具体样式实现时走 impeccable 技能。
- `DeviceCanvas.tsx`：接线 `onNetworkToggle`（沿 `onScreenshot` 先例）。

### 5. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/main/network/index.ts`（+ `__tests__/`） | 命令分发、合并读回解析（含 `2` 瞬态）、互斥、轮询器（inFlight/启停/变化才推）、桥接线导出 |
| `src/main/ipc/index.ts` | 注册网络域；`attachDeviceStreamBridge` 三回调 append 启停 |
| `src/shared/ipc-channels.ts`、`src/shared/types.ts` | 通道与类型 append |
| `src/preload/api/network.ts`、`api/index.ts`、`index.d.ts` | 桥 append |
| `src/renderer/src/components/DeviceToolbar.tsx`（+ 测试） | 三开关组：受控/busy/disabled/aria |
| `src/renderer/src/components/DeviceCanvas.tsx` | `onNetworkToggle` 接线 |
| `src/renderer/src/hooks/useNetworkSwitch.ts`（+ 测试） | toggle 状态机与 busy |
| `src/renderer/src/stores/deviceStore.ts`（+ 测试） | network 切片与跟随、设备移除清理 |
| `src/shared/i18n/mainWindow.ts`、`errors.ts` | 词条 append |
| `book/docs/PRD.md:80` | 补一句分 radio 口径（含「单关不断网、飞行/双关才断」语义） |

i18n 键（mainWindow 域 5）：`networkAirplaneToggle`、`networkWifiToggle`、`networkDataToggle`、`networkGroupAria`（分组可访问名）、`networkToggleFailed`（失败弹窗标题）——后两键为实现必需的合理增补（review P3-B 对齐记录）；（errors 域 3）：`networkDeviceNotRunning`、`networkCommandFailed`、`networkBusy`。

### 6. 测试面（Phase 4）

- 域单测：三目标命令 args 拼装；三行解析（`0`/`1`/`2`/垃圾/行数不足/exit 非 0 各路径）；互斥（快速双发第二发被拒）；轮询 inFlight 跳过、变化才推（同值不推）、读失败保留旧值；`startNetworkWatch`/`clearNetworkWatch` 生命周期（桥回调直调模拟）。
- renderer 测试：工具条三开关渲染与受控态跟随、busy/未 running 禁用、aria-label；store 跟随与清理；hook busy 流转。

## Done criteria — 设计阶段

需求与排除项填实（录屏、蜂窝整形、连通性探测明确排除）；影响图与风险有代码证据（桥挂点 82–98、互斥先例、通道登记格式）；命令与解析含瞬态值的映射定案；stage05 步骤挂本 plan 链接；book 索引构建通过。

实现阶段终点（Phase 3-6 另行勾选），真机/模拟器验收清单：

1. 断网总开关：点击 → 设备快速设置飞行模式亮、`ping 8.8.8.8` 失败；再点恢复、ping 通。
2. 设备内快速设置切飞行模式 → ≤1s 工具条开关跟随（两个方向各验一次）。
3. 单关 Wi-Fi → 开关跟随、网络仍通（蜂窝接管）；单关数据同理；双关 → 断网。
4. 飞行模式开启时点 Wi-Fi 开 → 关飞行模式后 Wi-Fi 按意愿恢复开（实测语义复验）。
5. 停止设备 → 轮询退订无残留 timer；重启设备 → 初值正确（残留态如实显示）。
6. 快速连点 → busy、串行、无双发竞态。
7. 三语词条与 aria-label 正确；全量测试、typecheck / lint / build 通过。

## 实施结果 — 2026-10-12（worktree feature/network-switch-group，基于 dev 文档批）

### Phase 3：实现

- 主进程 `src/main/network/`：`registerNetworkIpc(deps)` 返回 `{ startWatch, clearWatch }` 句柄（轮询态随每次 register 闭包重建，测试免手工复位）——命令分发（`cmd connectivity airplane-mode` / `svc wifi` / `svc data`）、合并单发读回（`settings get` ×3 一发三行，`wifi_on=2` 映射开）、1s 轮询（首拍立即执行、在途不叠发、读失败本轮放弃）、变化才推 `networkChanged`、`networkSet` 同步占位互斥 + 成功即读回（读回 null 不判错，轮询 1s 补推）。
- 生命周期接线：`attachDeviceStreamBridge` 的 `running`（serial 直取）启轮询、`stopped`/`beforeKill` 退订（与 `clearScreenshotCache` 并排）。
- preload `api/network.ts`（set + onChanged 订阅）；`deviceStore` 增 `network` 切片（applyNetworkState 直写、快照剪除消失设备键、无过期键保引用）；`useNetworkSwitch`（toggle busy 至读回确认、失败原生 dialog）；`DeviceToolbar` 三开关（分组 aria + aria-pressed 承载态 + 断网开启危险色）；`DeviceCanvas` 接线并做**渲染期派生**（非 running 一律置 null——store 残留态不点亮开关，镜像 useScreenshot 先例）；App 挂载期订阅 onChanged。
- i18n：mainWindow 域 5 键 + errors 域 3 键，三语齐备；PRD 80 行同步扩容（分 radio 口径与断网语义）。
- **偏差记录 1**：plan 文件清单未列 4 个既有测试文件——App 挂载期新增订阅使 App.logcat/reconciliation/wizard 与 DeviceCanvas.actions 的 `window.api` mock 缺 `network` 键连环挂 22 项，逐文件补 mock 形状（[learn](../notes/learn/2026-10/2026-10-12-app-mount-subscription-test-mock-shape.md)）。
- **偏差记录 2（自纠）**：Phase 3 首版 `networkState={net.state}` 直传，自审发现违反本 plan Boundaries「仅 running 可用」——设备停止后 store 残留态会让开关保持可点，改为渲染期派生后补跑测试。

### Phase 4：验证

- 新增测试 30 项（域 19 + store 3 + 工具条 3 + hook 5）；全量 **1085 项通过、6 项原有跳过**；typecheck 0 错；lint 与 dev 基线一致（余 1 条存量 error 见下）；build 通过。
- 真机/模拟器端到端验收**未做**：本机应用库当前 devices.json 为空（无已配置设备），向导自动化建设备超出本批范围。命令/读回/同步语义已由调研批在真实模拟器上全量实测（think-report 两轮记录），应用内链路待有设备后按验收清单 ①–⑦ 执行。

### Phase 5：review（只记录不修）

- P3-1：renderer 刷新（Ctrl+R / dev reload）后初值不可达——推送仅变化才发，刷新后开关禁用直到设备态变化或重启设备。一期接受（刷新属 dev 行为）；后续可加 `networkGet` 按需读通道。
- P3-2：飞行模式开启时推 Wi-Fi 开，读回 `wifi_on=2` 显示为开——「意愿态」展示，飞行关闭后系统按意愿拉起（语义已在 PRD 写明）；如需区分「意愿/实际」需换 dumpsys 级读回，成本不值。
- P3-3：`applyNetworkState` 不校验设备存在——未知 id 推送会挂 stale 键，下一次快照剪除自愈；无实际触达路径（推送仅来自本应用启动的 watch）。
- 存量发现：`DeviceWizard.tsx:458` effect 内同步 setState lint error（dev 基线即有，非本批引入），记 [issue](../notes/issue/2026-10/2026-10-12-devicewizard-setstate-in-effect-lint.md)。

### Phase 6：收尾

- 经验入 [learn：挂载期订阅的 mock 联动 / vi.fn 参数类型 / 轮询器不复活](../notes/learn/2026-10/2026-10-12-app-mount-subscription-test-mock-shape.md)；stage05 步骤附实现批注（真机验收未做，保持未勾）。
- 本 plan 保持 in_progress：验收清单 ①–⑦ 全过后翻 completed。

### 验收与追加批 — 2026-10-12

- 用户真机验收通过（「验收完毕，可以用」）：验收清单 ①–⑦ 走查通过；stage05 步骤勾选，本 plan 翻 **completed**。
- 追加修复批（用户批准）：存量 [issue DeviceWizard effect 内 setState lint error](../notes/issue/2026-10/2026-10-12-devicewizard-setstate-in-effect-lint.md) 已修——按同文件 391 行「依赖驱动不级联」豁免先例处理，并写明不改渲染期派生的语义理由（选中须持久，纯派生会随条件消失丢选择）；lint 全仓归零、41 项向导测试通过、无行为变化。
- review P3 修复批（用户批准，[review 记录](../notes/issue/2026-10/2026-10-12-network-switch-code-review.md)）：P3-A 解析按键级降级（`'null'` 行 → 该键 false，wifi-only 画像不再整域失效）；P3-1 新增 `network:get` 通道（main 返回 lastStates 内存快照）+ store `applyNetworkStates` 批量合并剪枝 + App 挂载拉快照——renderer 刷新后初值 ≤1s 恢复；P3-C 提炼 `networkApiMock` helper（4 个 App 级测试换用）；P3-B 本清单对齐。P3-2（飞行下意愿态展示）与 P3-3（applyNetworkState 不校验设备存在）**不修**——前者是批复语义（PRD 写明），后者加守卫会引入「推送被丢后不再补发」的真故障模式，劣于现状的快照自愈。新增 2 项测试、全量 1087 项通过，typecheck/lint/build 通过。

