---
description: 来源感知设备列表：设备出身标注（项目自有/Android Studio SDK，创建时落盘）+ 切 SDK 来源后主动重查全量可用性 + 镜像缺失时的来源指路文案
status: draft
created: 2026-10-12
---

# 来源感知设备列表（出身标注 + 切来源重查 + 指路文案）— plan

设计阶段（Step 0 / Phase 1 / Phase 2）草案，**设计轴待批复，实现未开始**。来源：用户报障「切到共享 Studio SDK 后左侧列表不变，点启动才失败」（2026-10-12 讨论）。讨论结论：设备列表不变是设计如此（avd-home 恒不迁移），缺口是切换后没有主动告知哪些设备不可用；本 plan 补三块——出身标注、切换重查、指路文案。

依据：[stage05](../stage/05-功能完善.md) 步骤「SDK 来源设置」（[plan 2026-10-11-sdk-source-switching](2026-10-11-sdk-source-switching.md)，共享切换/保留根语义已实现）、共享态向导收窄批（创建侧已只列可用镜像，本 plan 补存量侧）。

## Requirements brief — Step 0

### Background

设备（AVD 定义）恒在应用自有 `userData/avd-home`，SDK 来源切换从不迁移它；切换的是 SDK 根（系统镜像/emulator 二进制/platform-tools）。因此切共享后设备列表不变是既定边界，但设备能否启动取决于其 `image.sysdir.1` 引用的镜像在**当前生效** SDK 根中是否存在。现状缺口：可用性核验只在启动/删除失败/保存配置时运行，`sdk:source-changed` 推送仅设置窗消费——切换后列表看似一切正常，点启动才报核验失败。

本 plan 的三个组成与分工：

1. **出身标注**（静态，回答「这台设备是谁家的」）：创建时把当时的 SDK 来源记入设备 JSON。两桶划分与迁移语义自洽——托管↔自选迁移不跨越自有/共享边界，标注永不过期（根迁走设备仍「项目自有」且照样能启动）。
2. **切来源重查**（动态，回答「现在能不能启动」）：来源变更落地后主动跑一轮全量健康核验，可用性即时写回快照。**标注不参与启动判定**——`image.sysdir.1` 是相对路径，同名镜像可两根并存（跨来源可启动）；Studio 侧卸载镜像则切回去也不可用。唯一事实源是实时 fs 核验。
3. **来源指路文案**（两者汇合处）：镜像缺失且出身与当前来源不符时，核验消息给出精确恢复路径（「该设备创建于 Android Studio SDK——切换到共享来源可用」），行内 hint 与启动失败弹窗共用。

### Scope

- Affects：`DeviceMeta`（新增出身字段，随设备 JSON 落盘）、创建事务（写入出身）、`sdkSourceSwitch` 登记接线（来源变更触发 `reconcileDevices`）、reconcile 镜像核验消息（来源感知增强）、`DeviceRow`（出身徽标 + 既有 availability hint 消费增强文案）、i18n 三语、PRD §2.3 E 一句扩容。
- Does NOT affect：启动守卫语义（仍以 fs 核验为唯一事实源，标注零参与）、avd-home 位置与迁移边界、向导（收窄批已交付）、设备编辑/删除流程、设置窗（来源切换 UI 已有）、对账汇总条（复用现有 unavailableCount 呈现，不加新模块）、Studio `~/.android/avd` 的读取（明确不做——破隔离边界，见讨论结论）。
- Boundaries：出身字段创建后不可变（编辑/改名/配置变更均不触碰；删除重建自然重置）；重查仅覆盖 stopped 设备的 availability（starting/running/creating/deleting 不动，与既有各写入点的 runId/代次守卫互不干扰）；共享态仍只读——指路文案只指「切换来源」，绝不暗示可在共享态补装镜像。

### Requirement

| 能力 | 要求 | 一期边界 |
| --- | --- | --- |
| 出身标注 | 创建设备时记录来源桶：`shared` → 「Android Studio SDK」，`managed`/`custom` → 「项目自有」；列表行内可见 | 仅列表行展示；不做编辑入口 |
| 切来源重查 | 来源变更（切换/采纳/清除保留根等一切改变生效根的路径）落地后自动全量重查，行内状态即时刷新 | 沿用 `reconcileDevices` 单飞；不弹窗不打断 |
| 指路文案 | 镜像缺失 + 出身≠当前来源 → 行内 hint 与启动失败弹窗给出「切换到 X 可用」恢复路径 | 出身与当前来源一致时的镜像缺失维持既有通用文案 |
| 既有行为保持 | DeviceRow 启动钮已按 availability 禁用（`state !== 'valid'`），本 plan 不改判定，只让数据与文案变准 | — |

设计轴（**待批复**，▪ 为推荐项）：

- [ ] **轴 1 徽标显示范围**：▪ 仅「Android Studio SDK」出身设备显示徽标（项目自有是默认世界，减噪）；备选：两类都显示。
- [ ] **轴 2 存量回填**：▪ 缺席字段读取时静默视作「项目自有」（全部存量设备早于共享模式，事实安全；零迁移，同 formFactor v1 兼容先例）；备选：显示「未知」待首查归化。
- [ ] **轴 3 文案落点**：▪ 主进程 reconcile 镜像消息统一增强（行内 hint 与启动弹窗同源，`applyImageCheck` 已接收 meta 可读出身）；备选：渲染层派生（需把当前来源态引入主窗，多一条数据链）。
- [ ] **轴 4 重查接线**：▪ 登记点包装 `broadcast` 单点拦截（`sdkSourceChanged` 通道发出即触发，五个发射点全覆盖——切换/采纳/清除/恢复任一改变生效根的路径都不漏；sdkSourceSwitch 模块零改动）；备选：显式回调依赖注入。
- [ ] **轴 5 徽标形态**：▪ 图标 + tooltip 全称（Studio 用 lucide Buildings 或类似、项目自有仅轴 1 批复「仅共享显示」时无需图标）；备选：图标 + 短文字常显。

## Impact range — Phase 1

### 现状证据

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `src/renderer/src/components/DeviceRow.tsx:89` | 启动钮 `!storeTrusted \|\| availability === null \|\| state !== 'valid'` 即禁用；hint 显示 `标签：blocking.message` | 「禁用」已存在；缺的是切换后的新鲜数据与来源感知 message |
| `src/main/devices/index.ts:571` | `reconcileDevices()` 单飞（`reconcilePromise` 守卫）；1356/1576 删除/创建回滚后 `void reconcileDevices().catch(() => undefined)` 先例 | 切来源重查直接复用同款 fire-and-forget，不新建扫描链路 |
| `src/main/emulator/sdkSourceSwitch.ts:132,183,288,343,350` | `sdk:source-changed` 五个发射点（切换/采纳/清除保留根/恢复等） | 包装拦截一处覆盖全部；漏点风险为零 |
| `src/shared/types.ts:100-122` | `DeviceMeta` 持久层（设备 JSON 落盘）；`frameKind`/`availability` 是内存派生不入盘的对照先例 | 出身字段入 `DeviceMeta`（持久、随快照自然到达 renderer） |
| `src/shared/types.ts:109` | formFactor「v1 兼容读出为 'unknown'，不硬猜」注释先例 | 缺席出身字段的读取兼容有既有范式 |
| `src/main/emulator/reconcile.ts:502` | `applyImageCheck(health, meta, …)` 已接收完整 meta | 来源感知文案在主进程增强不需要改签名 |
| boot 链路 | `restoreSdkSource` 先于建窗（sdk-source-switching 批 2）；load 后稳定设备必有 availability | 重启场景天然正确：恢复来源在核验之前，无需额外 boot 工作 |
| `src/renderer/src/components/DeviceListPane.tsx:10` | `storeTrusted` 已传入 DeviceRow 作启动守卫 | 徽标与 hint 增强不引入新的数据依赖 |

影响图：

```text
sdkSourceSwitch（切换/采纳/清除/恢复 ×5 点）
    │ broadcast(sdk:source-changed)
    v
登记点包装拦截 ──► void reconcileDevices()  ←单飞，既有链路
                        │ 全量 checkDeviceHealth（当前生效根）
                        v
              availability 写回 + broadcastChanged
                        │
                        v
   DeviceRow：启动钮禁用（既有） + hint= 标签：镜像缺失消息
                                                ▲
   创建事务 ──► DeviceMeta.imageSourceOrigin ──► applyImageCheck
   （shared→AS SDK / managed|custom→项目自有）      出身≠当前来源时
                                                   message 附「切换到 X 可用」
```

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| 重查与启动竞态（切换后立刻点启动） | `reconcileDevices` 单飞 + beforeStart 各自独立即时核验（对账设计 4 现状）：启动前那一次核验才是拦截者，重查只是提前暴露；最坏情形是 hint 短暂滞后一拍 |
| 标注与实际镜像位置脱节（同名镜像双根并存 / Studio 侧卸载） | 标注零参与判定（Boundaries）；文案在出身≠当前来源**且**镜像缺失时才指路——两根并存时镜像核验通过，不产生任何提示，无误导 |
| 包装 broadcast 拦截点被未来代码绕过（直接持原始 broadcast） | 拦截在登记点（ipc/index.ts 组装处），模块内无原始引用可绕；测试断言五发射点都触发重查 |
| 重查抖动（连续快速切换来源） | 单飞守卫天然合并；进行中的一轮不取消，下一轮覆盖最新根（`reconcileDirs()` 每次现读） |
| 共享态只读被指路文案误导（暗示可装镜像） | 文案闭集：「切换到共享来源可用 / 切回项目自有来源可用」，不含任何安装指引；共享态安装类操作仍被既有守卫拒绝 |

## Design — Phase 2

### 1. 出身字段（types + 创建事务）

`src/shared/types.ts` `DeviceMeta` append：

```ts
/** 设备出身（持久）：创建时的 SDK 来源桶；缺席（存量）视作 app-owned */
imageSourceOrigin?: 'app-owned' | 'shared-studio'
```

- 写入点：`createDeviceTransaction` 组装 meta 处，读 `sdkSourceSnapshot().source`（`shared` → `shared-studio`，`managed`/`custom` → `app-owned`）。
- 读取兼容：所有消费点 `meta.imageSourceOrigin ?? 'app-owned'`——不迁移存量文件、不改 store 版本（轴 2 批复后生效）。
- 不可变：编辑/配置事务/重命名链路零触碰；`toMeta` 透传。

### 2. 切来源重查（登记点拦截）

`src/main/ipc/index.ts` 组装 `registerSdkSourceIpc` 处，把传入的 `broadcast` 包装：

```ts
const wrappedBroadcast = (channel, payload) => {
  broadcast(channel, payload)
  if (channel === IPC_CHANNELS.sdkSourceChanged) void reconcileDevices().catch(() => undefined)
}
```

- 复用 `reconcileDevices` 单飞（`reconcilePromise` 守卫合并并发）；内部 `scanCurrent` 全量核验并走既有报告刷新与 `broadcastChanged`，渲染层无新订阅。
- `sdkSourceSwitch` 模块零改动；五个发射点全覆盖（轴 4）。

### 3. 来源感知文案（reconcile 消息增强）

`applyImageCheck` 内镜像缺失分支（health error 落点处）：当 `meta.imageSourceOrigin ?? 'app-owned'` 与当前生效来源桶不符时，message 追加恢复指引词条；一致时维持原文。新词条（errors 域，键名 Phase 3 定，三语）：

- 出身 shared-studio、当前非共享：「；该设备创建于 Android Studio SDK——切换到共享来源可用」
- 出身 app-owned、当前共享：「；该设备的镜像在应用自有 SDK 中——切回托管或自选来源可用」

消息同时到达两处：行内 hint（`availabilityReason` 拼接）与启动失败弹窗（`startVerifyFailed: {message}`），零额外数据链（轴 3）。

### 4. renderer：出身徽标

`DeviceRow` 名称区 append 小徽标（轴 1/5 批复后定形态）：仅 `imageSourceOrigin === 'shared-studio'` 显示，lucide 图标 + tooltip 全称「Android Studio SDK」；三语 tooltip 走 mainWindow 词条 1 键。

### 5. 文件清单（Phase 3）

| 文件 | 工作 |
| --- | --- |
| `src/shared/types.ts` | `imageSourceOrigin` 字段 append |
| `src/main/devices/index.ts`（+ 测试） | 创建事务写出身；`toMeta` 透传；IPC 登记 export 出 `reconcileDevices` 供接线（如可见性需要） |
| `src/main/ipc/index.ts`（+ 测试） | broadcast 包装拦截 → `reconcileDevices` |
| `src/main/emulator/reconcile.ts`（+ 测试） | 镜像缺失分支的出身感知 message 增强 |
| `src/renderer/src/components/DeviceRow.tsx`（+ 测试） | 出身徽标；hint 消费增强后 message（拼接逻辑零改动，断言更新） |
| `src/shared/i18n/errors.ts`、`mainWindow.ts` | 指路词条 ×2 + 徽标 tooltip ×1，三语 |
| `book/docs/PRD.md` §2.3 E | 出身标注与重查语义一句扩容 |
| `book/stage/05-功能完善.md` | 步骤挂本 plan 链接（批复后） |

### 6. 测试面（Phase 4）

- 主进程：创建写出身（shared/managed/custom 三态断言）；存量缺席字段回填语义；包装拦截五发射点全触发重查（含清除保留根）；单飞合并（连续两次 source-changed 只跑一轮）；镜像缺失 message 的出身×当前来源四象限（一致→原文，不一致→指路，双根并存→核验通过无消息）。
- renderer：徽标条件渲染（仅 shared-studio、缺席不显示）；availability hint 含指路文案的快照渲染。
- 回归：全量测试、typecheck、lint、build；共享切换既有 27 项矩阵测试不动。

## Done criteria — 设计阶段

需求与排除项填实（Studio AVD 读取明确不做、启动判定不引入标注）；影响图与风险有代码证据（DeviceRow:89 禁用现状、reconcileDevices 单飞与 fire-and-forget 先例、五发射点、applyImageCheck meta 在手）；设计轴五条待批复；PRD/stage 挂链接列入实现批。

实现阶段终点（Phase 3–6 另行勾选），真机/模拟器验收清单：

1. 托管态有镜像设备若干 → 切共享：相关行立即出 hint 且启动钮禁用（不点启动）；AS 出身设备（若有）行内带徽标。
2. 共享下新建一台设备 → 徽标出现；切回托管 → 该设备 hint 指路「切换到共享来源可用」且禁用。
3. 切回托管 → 原 hint 设备全部恢复 valid、启动钮可用（保留根语义回归）。
4. 共享态在 Studio 侧卸载一台 AS 出身设备的镜像 → 切共享后该设备仍禁用，文案不含「切换可用」指路（出身一致、镜像真缺失）。
5. 托管↔自选迁移一次 → 「项目自有」设备全程可启动、无 hint 闪现（标注不因迁移改变）。
6. 快速连续切换来源两次 → 列表最终状态正确、无重查堆积报错。
7. 三语词条正确；全量测试、typecheck / lint / build 通过。
