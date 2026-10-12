---
description: SDK 来源切换设计：三态状态机与 sdk.json 持久化、路径迁移引擎（同卷 rename/跨卷 copy+verify+journal 崩溃恢复）、共享模式保留根与清除入口、AVD 镜像引用改写与设置窗交互
status: completed
created: 2026-10-11
---

# SDK 来源切换与路径迁移 — plan

覆盖 [stage05](../stage/05-功能完善.md) `[suggested]`「SDK 来源设置」步骤的全部范围（Studio 检测 + 三态来源 + 运行环境解析），重点设计本轮新增的迁移语义：**应用托管 ↔ 自选路径互切及自选换路径时 SDK 文件跟随迁移（带进度）；切共享 Studio SDK 时旧根原地保留、设置页提供清除入口；切回托管/自选时沿用或迁移保留的 SDK。**

依据：[SDK 来源调研](../notes/think-report/20261009022552-SDK共享检测与真机投屏.md) §2/§5（检测链、三态、只读约束）、[共享 SDK 调研](../notes/think-report/20261008112223-安卓模拟器节省空间与共享SDK.md) §3.5（资源模型与迁移警告）、[设置窗静态前端 plan](./2026-10-09-settings-frontend.md)（三态版面已定稿）、[PRD](../docs/PRD.md) §2.3 E/G。

## Requirements brief — Step 0

### Background

SDK 根目前硬编码在应用数据目录（`userData/AndroidSDK`），测试人员无法复用本机 Android Studio 已装的 SDK 与镜像，也无法把 SDK 放到外置盘。调研已定三态来源（托管默认 / 共享 Studio 只读 / 自选可写），本 plan 补齐用户追加的迁移行为：三种来源切换时 SDK 文件跟着走，切换过程可见进度，共享模式下旧 SDK 保留且可显式清除。

### Scope

- Affects：SDK 根的状态化与持久化（sdk.json）、三态切换编排与路径迁移引擎（预检/执行/进度/崩溃恢复）、AVD config.ini 镜像引用改写、Studio 检测模块、运行环境解析统一（Java 双布局）、设置窗「模拟器」页交互化（切换确认、迁移进度、保留根清除）、共享模式只读守卫。
- Does NOT affect：avd-home 与导入/下载皮肤目录（恒在应用数据目录，永不迁移/清除）、设备数据与配置编辑链路（除 config.ini 引用改写）、向导流程骨架（仅镜像来源与缺包提示变化）、资源防线（并行上限/内存水位，stage05 另一步另写 plan）、真机接入（stage06）。
- Boundaries：共享 Studio SDK 恒只读——不装/不升/不卸/不写许可；清除入口只删应用自有根（托管根与自选路径根），永不触碰 Studio 目录与 avd-home；迁移期间 SDK 域整体只读（拒启动/bootstrap/包操作）；一期 macOS only（检测与引擎的平台分支按研究写好单测，Windows 真机验证滞后属已知约束）。

### Requirement（用户五条语义 → 设计锚点）

| 用户要求 | 设计落点 |
| --- | --- |
| 托管 ↔ 自选互切、自选换路径：SDK 文件跟着迁移，状态保存 | 统一切换规则 + 迁移引擎（同卷 rename / 跨卷 copy+verify+delete）；`sdk.json` 持久化 source 与 customPath |
| 切共享 Studio：页面多一个按钮，可清除之前的路径或应用内路径；不清除则一直保留 | 共享切换永不迁移；旧根原地保留为「保留根」；保留根区与清除入口**仅共享模式**显示，非共享模式不出现任何清除入口（用户既定） |
| 切回托管/自选：直接用之前路径下的 SDK，或把之前路径的 SDK 迁到新位置 | 统一规则：目标空 → 迁移或空根起步；目标已有 SDK → **二选一询问**（迁移替换 / 直接使用，落选 SDK 删除、确认框必经）；从共享切回沿用保留根且无落选内容时直接切换 |
| 迁移过程需要进度展示 | `sdk:migrate-progress` 事件（phase/percent/字节/当前条目，100ms 节流）+ 设置页进度条与取消（=回滚） |
| 页面判断本机是否装了 Android Studio，未装则禁用共享选项 | 检测结果的 `studioFound` 驱动共享单选禁用态 + 原因词条；`sdk:source-set` 服务端同样拒绝（禁用态可被伪造入参绕过，双保险） |

## Impact range — Phase 1

### 现状证据

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| [emulator/index.ts:31-32](../../src/main/emulator/index.ts) | `defaultSdkRoot()` = `userData/AndroidSDK`，注释明示「设置自定义路径属 stage 05」 | 根解析改为读状态；函数保留为托管根常量 |
| [devices/index.ts:115-126](../../src/main/devices/index.ts) | `sdkRoot()`/`avdHome()` 双双硬编码；两模块「同源」靠约定 | 两处统一切到 `resolveSdkRoot()`；avdHome 不动 |
| [devices/index.ts:173-193](../../src/main/devices/index.ts) | adb 解析、env（ANDROID_SDK_ROOT/USER_HOME）、[1018-1021](../../src/main/devices/index.ts) emulatorPath/adbPath 全部拼自硬编码根 | 改经解析层产出，消费点不改逻辑只换来源 |
| [devices/index.ts:1408-1416](../../src/main/devices/index.ts) | `scanLocalImages(sdkRoot())` 镜像扫描以根为界 | 迁移后扫描自然跟随新根；reconcile realpath 越界检查接受「当前活动根」 |
| [emulator/sdk.ts:31-55](../../src/main/emulator/sdk.ts) | `sdkPaths(root)` 已参数化；`detectSdk`/`planBootstrap` 缺件补齐可直接复用 | 「采用已有 SDK 后缺件」场景由既有 bootstrap 兜底，不新写 |
| [emulator/sdk.ts:45-47](../../src/main/emulator/sdk.ts) | Java 固定 `<root>/jre/Contents/Home`（mac 布局，bootstrap 自带） | 共享根无此布局 → 解析层对 shared 用 Studio JBR，缺失给中文可操作错误 |
| [emulator/avd.ts:42-69](../../src/main/emulator/avd.ts) | AVD 经 `avdmanager create avd -k <包名>` 创建 | **avdmanager 把镜像绝对路径写进每个 .avd/config.ini（image.sys.src.dir）——换根不改写则设备全部断链**；[patchAvdConfig:126-155](../../src/main/emulator/avd.ts) 的白名单原子改写是现成先例 |
| [emulator/index.ts:98-108](../../src/main/emulator/index.ts) | 镜像下载互斥 + 皮肤下载互斥先例 | 扩为 SDK 全局互斥：迁移/清除期间拒绝 bootstrap、下载、卸载、皮肤下载 |
| [emulator/runner.ts:16](../../src/main/emulator/runner.ts) | RunnerRegistry 按 phase（starting/running/stopping）管会话 | 迁移预检数 starting/running 条目，>0 拒绝并提示先停设备 |
| [locale/store.ts](../../src/main/locale/store.ts)、theme 同构 | json 状态先例：boot 读入、内存先行、tmp+rename 原子落盘、损坏回落 | sdk.json 与 sdk-migration.json 沿此先例 |
| [ipc-channels.ts:61-88](../../src/shared/ipc-channels.ts)、[preload/api/sdk.ts](../../src/preload/api/sdk.ts) | `sdk:progress` 等通道 + preload on 订阅先例 | 迁移进度事件复刻同形态 |
| [settings/PaneEmulator.tsx](../../src/renderer/src/components/settings/PaneEmulator.tsx) | 三态/路径/资源控件已画好但 `disabled` 静态 | 去静态接真数据；确认卡/进度/保留根区为新增块 |

### 风险与处理

| 风险 | 处理 |
| --- | --- |
| 迁移中断电/杀进程留下半个 SDK | journal（sdk-migration.json）逐条目记账，copy-then-delete 保证条目级可重入；boot 检测未完成 journal → 设置页横幅「继续迁移 / 回滚」；活动根在完成前不切换，期间 SDK 域只读 |
| 跨卷 rename 抛 EXDEV、外置 FAT/exFAT 无执行位 | statfs 同卷才 rename；跨卷走流式 copy+校验（文件数+字节数）；预检目标卷文件系统，FAT/exFAT 默认拒绝（jre 不可执行），词条说明原因 |
| 目标卷空间不足 | 预检 `剩余 ≥ 源体量 × 1.05 + 200MB`，不足拒绝并给清理建议（清保留根/换同卷路径） |
| 迁移中设备/包操作并发 | 双闸：运行会话 >0 拒绝迁移；迁移持有 SDK 全局互斥，反向操作（启动/bootstrap/包/皮肤）也拒绝 |
| 共享 adb server 二进制在旧根 | 不 kill-server（红线）；零会话前置下 server 空闲，迁移后下次解析自然用新根 adb，版本相同无漂移 |
| 清除保留根误伤仍绑定它的设备 | 清除前列出该根上绑定设备数并警告「清除后 N 台设备无法启动」；PRD 允许删除但必须知情 |
| 两处应用根同时有内容（采用 + 保留） | 不变量放宽为「至多一个活动根」；非活动有内容的根进保留根清单，清除入口统一收口 |
| `android-user`（sdkmanager 偏好）内潜在绝对路径 | 随根整体迁移，真机验收覆盖一次换根后的创建/卸载回归 |

## Design — Phase 2

### 1. 状态模型与持久化

`userData/sdk.json`（沿 locale/theme store 先例；损坏/缺失回落默认 `managed`，不静默改写）：

```ts
type SdkSourceMode = 'managed' | 'custom' | 'shared-studio'

interface SdkSourceFile {
  version: 1
  source: SdkSourceMode            // 活动来源——迁移完成才翻，迁移中保持旧值
  customPath: string | null        // 自选根（绝对路径，采纳时已核验）
  sharedPath: string | null        // 共享根（检测采纳时的已核验路径）
}
```

journal 独立文件 `userData/sdk-migration.json`（迁移期间高频写，与主状态分离）：

```ts
interface SdkMigrationJournal {
  fromRoot: string
  toRoot: string
  targetSource: 'managed' | 'custom'
  targetCleared: boolean         // 迁移替换分支：目标原有内容是否已删（崩溃恢复不重复删）
  entries: { name: string; bytes: number; files: number; done: boolean }[]  // 顶层条目
  phase: 'scan' | 'moving' | 'relink' | 'done' | 'failed'
  movedBytes: number
  error?: string
}
```

新模块 `src/main/emulator/sdkSource.ts`：boot 装载、内存态、原子 persist、以及解析面——

- `resolveSdkRoot(): string`——按 source 返回活动根（managed → `defaultSdkRoot()`；custom → customPath；shared → sharedPath）。
- `resolveRuntime(root): { sdkRoot, javaBin, sdkmanagerBin, avdmanagerBin, adbBin, emulatorBin, env }`——包装既有 `sdkPaths(root)`；shared 模式 javaBin 改指 Studio JBR（`<Studio.app>/Contents/jbr/Contents/Home`，检测链附带产出；缺失抛中文可操作错误）。
- `isSharedReadOnly(): boolean`——写操作守卫的总开关。

### 2. 统一切换规则（矩阵）

不变量：**avd-home 与导入皮肤永不迁移；共享根永不被本应用写入或删除；只有应用自有根（托管根/自选根）会迁移或被清除；保留态只存在于共享模式——非共享模式下，切换完成后不允许存在有内容的非活动应用根（迁移即移动、二选一落选即删）。**

切到 `managed` 或 `custom` 时按目标根判定：

| 目标根状态 | 动作 |
| --- | --- |
| 空或不存在，且其他应用自有根（活动根或保留根）有内容 | **迁移**（=移动）：确认卡展示体量/来源/目标/影响设备数 → 确认后迁移引擎接管 |
| 空或不存在，且处处皆空 | **空根起步**：source 翻新值，首次进向导走既有 bootstrap |
| 已有可识别 SDK（platform-tools / emulator / cmdline-tools 任一在场），且另有应用自有根有内容 | **二选一询问**：① 迁移替换——目标已有 SDK 删除，当前 SDK 移动过去（确认框明示目标内容将被删）；② 直接使用——source 翻到目标，落选的应用自有 SDK 删除（确认框明示原 SDK 将被删）。两个确认框都列出受影响绑定设备数；缺件由既有 planBootstrap 按需补齐 |
| 已有可识别 SDK，且无其他应用自有根有内容（典型：从共享切回，目标就是保留根） | **直接切换**：无任何删除动作，不弹确认，仅提示沿用该路径 SDK |
| 有不可识别杂物 | 拒绝切换，词条要求清空或另选路径 |

其余转换：

| 转换 | 动作 |
| --- | --- |
| 任意 → `shared-studio` | **永不迁移**：当前根原地保留为保留根；前提是 `studioFound`（Studio 本体在场）且 sharedPath 已核验——Studio 未装时页面禁用该选项、`sdk:source-set` 服务端同样拒绝；手选路径与 Studio 实际路径 realpath 相同时自动按共享处理（研究既定规则） |
| `shared` → `shared` | 仅更新 sharedPath（重新检测采纳） |
| 运行会话 >0 时任何切换 | 拒绝 + 「先停止设备」词条；journal 未收尾时同样拒绝并引导去设置页 |

### 3. 迁移引擎 `src/main/emulator/sdkMigration.ts`

预检（全过才建 journal）：

1. 运行会话 = 0（RunnerRegistry starting/running 计数）。
2. SDK 全局互斥空闲（扩展 packageOps 互斥域），获取后持有至迁移收尾。
3. 目标根判定（上表）；跨卷时 statfs 校验空间 `≥ 源体量 × 1.05 + 200MB`；目标卷 FAT/exFAT 拒绝；目标父目录 mkdir 探针。
4. 源根先清 `.tmp-*` 半成品（bootstrap 残留）。

执行（逐顶层条目，journal 每完成一条原子落盘）：

- **替换前置**（二选一的迁移替换分支）：先删目标已有内容，journal 记 `targetCleared: true` 落盘后才开始移动条目——崩溃恢复时已清不重复删。
- **同卷**（statfs 设备号相同）：`rename` 原子移动，按条目推进进度。
- **跨卷**：流式复制到 `<target>/.migrating/<entry>` → 校验（文件数 + 字节数逐条对比）→ 同卷 rename 归位 → 删源条目。copy-then-delete 使任意崩溃点可重入：残留 `.migrating` 半成品删除重拷，源条目在归位前始终完整。
- 全部条目完成后 **relink 阶段**（详见 §4），再 `detectSdk(toRoot)` 复核组件在场性不低于迁移前 → journal.phase='done' 落盘 → sdk.json 翻 source → 删 journal → 广播 `sdk:source-changed` → 删空源根目录。
- 崩溃恢复：boot 见 journal → 设置页横幅「上次迁移未完成」：**继续**（幂等续跑）/ **回滚**（已移条目 rename 回源，清 `.migrating` 与 journal）。source 未翻，期间 SDK 域只读、启动被拦并指路。
- 取消 = 回滚（同崩溃回滚路径）。

进度事件 `sdk:migrate-progress`（100ms 节流，复刻 sdk:progress 形态）：

```ts
interface SdkMigrationProgress {
  phase: 'scan' | 'moving' | 'relink' | 'cleanup' | 'done' | 'failed' | 'cancelled'
  percent: number            // movedBytes/totalBytes；无字节阶段按条目推进
  movedBytes: number
  totalBytes: number
  currentEntry: string | null
  error?: string
}
```

### 4. AVD 引用改写（设备不断链的必要步骤）

遍历 avd-home 各 `*.avd/config.ini`：值为「非活动应用自有根」前缀的路径键（`image.sys.src.dir`、`skin.path` 及任何绝对路径键），若同相对路径在新活动根存在 → 前缀改写；不存在 → 保留原引用（该设备绑定在保留根上，随保留根存亡）。**共享根的引用一律不改写**（Studio 目录稳定，本应用永不清除）。改写走 patchAvdConfig 同款原子写。两个出口都消费同一计数：迁移替换确认框列「目标根上绑定设备数」（删除目标内容会断这些设备，除非镜像同在源根）；直接使用确认框与共享模式清除警告列「落选/保留根上绑定设备数」。

### 5. Studio 检测 `src/main/emulator/studioDetect.ts`（研究 §2.5 既定方案）

候选链（逐级核验后采纳）：Studio 配置目录 options 的 SDK 路径 → `ANDROID_HOME`/`ANDROID_SDK_ROOT` → 平台默认目录（`~/Library/Android/sdk`）→ PATH 上 adb 反推 → 手选。核验 = platform-tools 或 licenses 在场。附 `isStudioSdk(path)`（realpath 对比）与 Studio JBR 路径产出。fs/spawn 接缝注入可单测。

检测结果区分两层、分别驱动不同 UI：`studioFound`（Studio 本体是否装了——/Applications 扫描 + mdfind 兜底）与 `sdkCandidate`（SDK 路径是否定位成功）。**共享选项的禁用态只由 `studioFound` 驱动**：未装 Studio → 选项禁用 + 原因词条；装了但 SDK 未定位 → 选项可选，采纳前须先经检测链或手选核验出 SDK 路径。

### 6. 共享模式只读守卫

`isSharedReadOnly()` 为真时：bootstrap、镜像下载/安装/卸载、许可写入全部拒绝（词条引导回 Studio 的 SDK Manager 或切换来源）；向导只列已装镜像；emulator 版本低于镜像要求时列表可见但启动被拦并说明（研究既定）。托管/自选保留完整包操作。

### 7. 设置窗交互（PaneEmulator 交互化）

沿用已定稿三态版面，新增三块：

```text
| 切换确认卡（点选其他来源时出现）                              |
| 将 SDK 从 ~/Library/Application Support/…/AndroidSDK        |
| 迁移到 /Volumes/Backup/sdk（约 6.2 GB，同卷快速移动）        |
| 影响：3 台设备的镜像引用将改写；目标卷剩余 120 GB。           |
|                          [取消]  [开始迁移]                  |
| 二选一卡（目标路径已有可识别 SDK 时替代确认卡）               |
| /Volumes/Backup/sdk 下已有 SDK（6.8 GB）。                   |
| ① 迁移替换：删除该 SDK，把当前 SDK（6.2 GB）移动过去         |
|    ——目标根上绑定 2 台设备，镜像同在源根的将改写续用          |
| ② 直接使用：使用该 SDK，删除 ~/…/AndroidSDK（6.2 GB）        |
|    ——落选根上绑定 3 台设备，镜像不在目标根的将无法启动        |
|                   [取消]  [迁移替换…]  [直接使用…]           |
| 迁移进度                                                      |
| [############------------------] 42%  2.6/6.2 GB            |
| 正在移动 system-images/android-34/…        [取消（回滚）]   |
| 保留的 SDK（仅共享模式显示）                                  |
| ~/…/AndroidSDK   6.2 GB · 绑定 3 台设备        [清除…]      |
| 清除后不可恢复（可重新下载）；绑定设备将无法启动。            |
```

- 三态单选：**共享选项由 Android Studio 在场性驱动**——模拟器版面打开时自动跑一次检测（主进程缓存结果，「重新检测」手动刷新）；`studioFound` 为假时共享单选禁用并附原因词条（如「未检测到 Android Studio」），键盘与点击均不可选；Studio 在场但 SDK 未定位时可选，采纳前须核验出 SDK 路径；采纳前展示核验快照（工具/emulator 版本与差异警示）。
- 当前来源为共享但 Studio 已被卸载（检测结果从在场翻缺席）：共享单选保持选中但选项区警示「共享根可能已失效」，引导切回托管/自选；期间设备启动走既有组件缺失错误路径。
- 「重新检测」「选择目录…」按钮接通（目录选择走主进程 dialog + 路径核验）。
- 迁移/清除期间页面锁切换；关闭设置窗不中断主进程任务，重开可续看（`sdk:source-get` 拉全量快照含进度）。
- 保留根区与清除入口**仅共享模式**显示；非共享模式不出现任何清除入口，且切换语义保证非共享模式不产生落单根（§2 不变量）——`sdk:source-clear-retained` 在非共享态被服务端拒绝，禁用态可被伪造入参绕过。
- 清除走原生 dialog 二次确认（后果 + 绑定设备数）；删除为后台任务复用进度组件（phase=cleanup/clearing）。
- 三语文案进 `src/shared/i18n/settings.ts`（errors 域补拒绝词条）。

### 8. IPC 契约

| 通道 | 形态 | 说明 |
| --- | --- | --- |
| `sdk:source-get` | invoke | 状态快照：source/三根路径/保留根清单（含体量与绑定设备数）/迁移进度/检测结果（studioFound + 候选，读缓存不触发扫描） |
| `sdk:detect-studio` | invoke | 跑检测链并刷新缓存，返回 studioFound/候选与核验快照（版面打开的自动检测与「重新检测」共用） |
| `sdk:source-set` | invoke | 矩阵判定：返回 `direct`（已直接完成，含无落选内容的沿用切换）/ `needs-migration`（附计划：体量/来源/目标/影响设备数）/ `needs-choice`（目标已有 SDK 且有落选内容：附双方体量与绑定设备数）/ `rejected`（原因词条；含 Studio 未装拒绝共享、运行会话 >0、journal 未收尾） |
| `sdk:source-migrate` | invoke | 携带计划开始迁移（预检不过拒绝；替换分支先清目标） |
| `sdk:source-adopt` | invoke | 直接使用分支：翻 source 到目标根并删除落选应用根（确认语义在 UI 二选一卡完成，此处再校验一次前置） |
| `sdk:source-migrate-cancel` | invoke | 取消 = 回滚 |
| `sdk:source-clear-retained` | invoke | 确认后删除指定保留根；**仅共享模式可调，其余来源态服务端拒绝** |
| `sdk:source-changed` / `sdk:migrate-progress` | event | 广播与进度 |

写通道仅设置窗 sender 可调（沿设置窗 sender 守卫先例）。

### 9. 文件清单

| 文件 | 工作 |
| --- | --- |
| `src/shared/types.ts`、`src/shared/ipc-channels.ts` | 来源/迁移类型与通道常量 |
| `src/main/emulator/sdkSource.ts`（新） | 状态 store + resolveSdkRoot/resolveRuntime/isSharedReadOnly + boot 装载 |
| `src/main/emulator/studioDetect.ts`（新） | 检测链 + isStudioSdk + JBR 路径 |
| `src/main/emulator/sdkMigration.ts`（新） | 预检/扫描/journal/同卷 rename/跨卷 copy+verify/relink/恢复 |
| `src/main/emulator/avd.ts` | 导出 config.ini 前缀改写 util（供 relink 与清除计数复用） |
| `src/main/emulator/index.ts`、`src/main/devices/index.ts` | 硬编码根改经解析层；共享只读守卫接进 bootstrap/下载/卸载/皮肤；互斥扩域 |
| `src/main/ipc/index.ts`、`src/preload/api/sdk.ts` | 新通道注册 + sender 守卫 + 白名单桥与事件订阅 |
| `src/main/index.ts` | boot 装载 sdk.json + 未完成 journal 检测 |
| `src/renderer/src/components/settings/PaneEmulator.tsx`、`model.ts` | 交互化 + 确认卡/进度/保留根区 |
| `src/shared/i18n/settings.ts`、`errors.ts` | 三语 UI 与拒绝词条 |

## Build order — Phase 3

1. **文档前置**：PRD §2 E/§4 修订（「独立 SDK 根」→ 三态来源 + 迁移语义 + 共享选项在场性禁用规则的决策记录），stage 步骤挂本 plan。
2. **状态与解析**：sdkSource store + 两处硬编码根切换 + boot 装载。验证：默认行为不变（managed = 旧路径），全量回归绿。
3. **检测模块**：studioDetect 四级候选链 + isStudioSdk + JBR，接缝单测；`sdk:source-get`/`detect-studio` 通道与设置页共享行「重新检测」接通。
4. **迁移引擎**：纯函数拆分（扫描/计划/条目移动/校验/relink 计划），fs 接缝注入；EXDEV 模拟、journal 重放、回滚测试。验证：单测全绿 + dev 环境小体量（仅 platform-tools）真机迁移走通。
5. **切换编排与守卫**：矩阵判定 + 写通道 + SDK 全局互斥 + 运行会话拦截 + 共享只读守卫。
6. **设置窗交互化**：确认卡/进度条/保留根清除/三语；崩溃恢复横幅。
7. **真机验收**（见 Test plan 的集成清单）后按 workflow 收尾。

## Test plan — Phase 4

- 单测：store 容错（缺失/损坏/非法字段回落 managed）；resolveSdkRoot/resolveRuntime 三态与 JBR 缺失错误；检测链逐级回落与核验；**studioFound 为假时共享选项禁用词条 + `sdk:source-set` 拒绝（伪造入参绕不过）**、Studio 在场但 SDK 未定位时可选不可采纳；矩阵判定全转换枚举断言（含杂物拒绝、realpath 同路径转共享、**何时二选一/何时直接切换**）；journal 幂等重放与回滚（含 **targetCleared 替换恢复不重复删**）；跨卷 EXDEV 回退 copy+verify；空间/FAT 预检拒绝；relink 前缀改写（有/无同路径/共享根不动/注释保留）；**adopt 分支删除落选根与绑定设备计数**；**非共享态 `clear-retained` 服务端拒绝**；共享只读守卫逐操作拒绝；运行会话拦截；sender 守卫；**不变量：任一切换完成后非共享模式无非活动有内容应用根（迁移/二选一收尾断言）**。
- 真机集成（dev 环境）：① 带一个镜像 + 一台设备从托管迁到外置卷 → 设备冷启动成功（断链验证）；② 迁移中杀进程 → 重启横幅 → 继续完成；③ 迁移中取消 → 回滚后设备照常启动；④ 切共享（真机本机 Studio）→ 保留根显示 → 清除警告含绑定设备数 → 共享下创建/启动用已装镜像；⑤ shared 切回托管三分支（直接用/迁回/空根起步 + 向导 bootstrap）；⑥ 目标非空二选一——迁移替换与直接使用各走一遍（确认框、落选删除、设备影响文案核对）+ 缺件补齐。
- 回归：全量测试、typecheck、lint、build；干净机器画像枚举沿 [issue 2026-10-09-profiles-clean-machine-no-java](../notes/issue/2026-10/2026-10-09-profiles-clean-machine-no-java.md) 口径复核。

## Done criteria

矩阵全部转换可走且**既有设备不断链**（真机验收记录在 stage）；崩溃恢复与回滚有单测覆盖并有真机演练；共享模式只读守卫生效；迁移/清除全程有进度且取消语义明确；**非共享模式无清除入口且不变量（无非活动有内容应用根）有单测**；PRD 与 stage/plan/book 已同步、索引已重建；review 按 workflow 只记录不修复。

## 设计轴批复 — 2026-10-11（用户逐条确认）

- [x] 迁移 = **移动**（迁移后源根清空并删空目录），非复制；跨卷瞬时占用双倍空间由预检与确认卡明示。
- [x] 清除入口**仅共享模式**存在；非共享模式不允许清除、不出现任何入口。配套不变量：非共享模式下不允许存在有内容的非活动应用根——由下条「二选一落选即删」保证，故不会出现无处可清的落单 SDK（原草案的顾虑由此消除）。
- [x] 迁移前确认卡必经（体量/路径/影响设备数），不做静默迁移；清除走原生 dialog 二次确认并列出绑定设备数。
- [x] 目标已有可识别 SDK 时**二选一询问**：迁移替换（目标原有 SDK 删除，确认框）或直接使用（原 SDK 删除，确认框）；两框均列受影响设备数。无落选内容时（从共享切回沿用保留根）直接切换不询问；缺件由既有 bootstrap 按需补齐。
- [x] 迁移需零运行会话；迁移中 SDK 域只读（启动/bootstrap/包/皮肤全拒，词条指路）。

## 实施记录 — 2026-10-11（批 1–6 完成，真机验收待做）

- **批 1**：PRD §2.3 E/§4.2/§6 决策记录补迁移语义与在场性禁用规则。
- **批 2**：`sdkSource.ts`（sdk.json store + `resolveSdkRoot`/`javaHomeFor`/`isSharedReadOnly`）接管 `emulator/index.ts` 与 `devices/index.ts` 两处硬编码根；boot `restoreSdkSource` 先于建窗。
- **批 3**：`studioDetect.ts` 四级候选链（配置文件→env→默认目录→PATH adb，逐级核验）+ `studioFound`/`sdkCandidate` 分层 + Studio JBR；`sdk:source-get`/`sdk:detect-studio` 通道（设置窗 sender 守卫）；avdmanager 的 JAVA_HOME 经 `javaHomeFor` 支持共享 JBR。**偏差**：设置页接线并入批 6 一次做（避免同块两改）。
- **批 4**：`sdkMigration.ts` 引擎（扫描/预检含 FAT 与空间口径/同卷 rename/跨卷 copy+校验+journal `targetCleared`/relink/续跑/回滚）+ avd.ts 前缀改写纯函数；FakeFs 全接缝单测 13 项（EXDEV、校验失败、取消-续跑、回滚、替换分支）。
- **批 5**：`sdkSourceSwitch.ts` 编排（矩阵判定 + start/resume/cancel/adopt/clearRetained + 成功才翻 source）+ 7 个写通道 + 双闸守卫（共享只读 / 迁移 journal）接进 bootstrap/下载/卸载/皮肤与 devices 创建/启动；27 项矩阵与收尾测试。**关键返工**：守卫从「真实 fs 读 journal」改为内存标志 + boot 盘面校准（`isMigrationActive`，同步零 await）——真实 fs 读在并行满载下扰动 devices 时序敏感用例（详见 learn）。
- **批 6**：`useSdkSource` hook + `PaneEmulator` 交互化（三态/确认卡/二选一卡/进度/崩溃恢复横幅/保留根清除，原生 dialog 确认必经，三语词条 49 键 ×3）+ `sdk:choose-custom-root` 目录选择；9 项交互测试 + 设置窗既有用例更新。
- 验证：1046 项测试全绿（6 项原有跳过）、typecheck/lint/build 通过；踩坑与遗留见 [learn](../notes/learn/2026-10/2026-10-11-sdk-source-async-predicate-and-sync-guard.md) 与 [issue](../notes/issue/2026-10/2026-10-11-sdk-source-shared-wizard-guide-and-journal-corruption.md)。
- **未做**：真机集成验收（Test plan ①–⑥——带镜像迁移断链验证、杀进程恢复、切共享/切回三分支、二选一实操）；干净机器画像枚举沿 issue 2026-10-09 口径待复核。
- **2026-10-12 引导交互两段化（用户反馈续）**：① 许可拒绝 = 用户主动取消——main 侧 handler 匹配 `msg('licenseRejected')` 静默返回当前态（同进程同 locale，匹配可靠），不进错误通道；② 忙碌态改由首个 `sdk:progress` 事件驱动（preload 补 `onSdkProgress` 订阅，此前注释有述实缺）——点击后先 pending（钮禁用、许可弹窗在途、无动画），确认通过开始下载才转「引导中」；引导钮不清 bootstrapable（取消后错误块仍在，可再次发起；真成功画像错误清零按钮自然消失）。新增 2 项测试（进度驱动忙碌、拒绝静默恢复），全量 1132 项通过。
- **2026-10-12 引导入口补全（用户报障：清除保留 SDK 后切回托管报「SDK 尚未就绪」且重试无效）**：`sdk:bootstrap` 通道与 preload 桥一直存在但**无任何 UI 消费**——原验收清单 ⑤ 的「空根起步 + 向导 bootstrap」半成品，被清除级联暴露。补法：向导画像页错误块在清单报错时探测 `sdk.status()`，JRE/cmdline-tools 缺失则出现「完成 SDK 引导」按钮（busy 态 + 失败文案，wizard 域三键三语）；成功自动重拉清单。共享态的 sdkSharedNotReady（指路 Studio SDK Manager）不走此按钮（探测发现组件在 JBR 语义下由共享根负责）。新增 1 项测试（未就绪→按钮→bootstrap 调用→画像重拉成功），全量 1131 项通过。
- **2026-10-12 语义修订（用户批复，推翻原设计轴「清除永不触碰设备数据」）**：共享态下清除保留 SDK 时**级联删除全部项目自有设备**——镜像随保留根永久消失，设备留着只会是永不复原的死行。实现：devices 域 `purgeAppOwnedDevices`（逐台走删除流、运行先停、失败逐台收集；跨桶只读守卫在此路径放行——清除即对另一桶的系统性清理）+ `appOwnedDeviceCount`（确认框计数，`sdk:app-owned-device-count` 通道）；清根 handler 先删 SDK 后清设备（主操作优先完成，失败汇总上报）；确认框 detail 换级联警告（含设备数，settings 域新键 `clearConfirmDeviceCascade` 三语）。旧口径 `boundDevicesSuffix` 保留给迁移/二选一流程。新增 1 项域测试（只删项目自有、绕过守卫、共享机独存），全量 1130 项通过。
- **2026-10-13 用户真机验收通过**：迁移链路 Test plan ①–⑥ 全过——带镜像迁移断链验证、迁移中杀进程恢复续跑、迁移中取消回滚、切共享/切回三分支（直接用/迁回/空根起步+向导引导）、目标非空二选一实操；干净机器画像枚举沿 issue 2026-10-09 口径复核通过。交互延伸批（出身标注/过滤视图/清除级联/引导入口）已另批验收。本 plan 翻 completed。
- **2026-10-12 追加修复**：迁移完成后进度卡不消失（用户报障）——useSdkSource 终态停留 2.5s 自动收起 + done 标题；source-changed 刷新对滞留活动进度做防御性 done 收口（终态事件丢失兜底）；PaneEmulator.test 增 2 项回归（含 fake timers 与 async act 冲刷的时序写法）。
