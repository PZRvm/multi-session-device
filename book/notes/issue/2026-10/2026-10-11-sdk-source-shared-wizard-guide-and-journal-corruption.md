---
description: 共享 Studio SDK 模式四个遗留——向导缺包引导 UI 未做、journal 损坏无接管、ANDROID_USER_HOME/EMULATOR_HOME 落共享根内、source-adopt/source-migrate 缺 Studio 路径服务端复验（伪造载荷可把 Studio 根当可写自选根）
tags: [SDK 来源, 向导, 崩溃恢复]
---

# SDK 来源批遗留：共享向导缺包引导与 journal 损坏接管

**登记**：2026-10-11，plan [2026-10-11-sdk-source-switching](../../../plans/2026-10-11-sdk-source-switching.md) 实现批（批 1–6）收口时记录，按 workflow 只登记不顺手修。

## 问题一：共享模式向导的缺包引导 UI 未实现（P3）

> 2026-10-12：由 [plan 2026-10-12-shared-mode-wizard-installed-only](../../../plans/2026-10-12-shared-mode-wizard-installed-only.md) 承接——共享态向导整体收窄（画像只列已装可用、API 只列已装、隐藏下载/卸载与筛选、缺包指路 Studio 空态）。实施完成前本条保持 open。
> 2026-10-12 实现批完成（详见 plan 实施记录）：收窄与引导全部落地、1052 项全绿；真机验收后本条翻 resolved。
> 2026-10-12 补充：收窄批已随 dev 合入并经用户真机使用（共享向导反馈批可证）；真机全量验收清单仍挂在 stage，验收后正式翻 resolved。

main 侧守卫已闭环：`sdkDownloadImage`/`sdkUninstallImage`/`sdkBootstrap` 在共享态被 `assertSdkWritable` 拒绝（词条引导回 Studio 或切换来源）。但向导 renderer 未按共享态预处理：下载按钮仍可点，用户点了才收到报错；plan §6 的「向导只列已装镜像、下载项禁用并说明缺包去 Studio 装」只做了 main 侧拦截，未做 UI 预禁用与说明。

**建议方向**：向导镜像清单按 `sdkSourceSnapshot.source === 'shared-studio'` 给未装项渲染禁用态 + 共享说明词条；或 wizard 能力接口带出共享标记。

## 问题二：journal 文件损坏时无接管（P3）

> **2026-10-12 resolved（fix/issue-audit 第二批）**：readMigrationJournalState 拆三态（absent/present/corrupt 带 raw）；prime 对 corrupt 置位（守卫拦启动/包操作）；快照带 journalCorrupt、设置页横幅仅回滚；回滚走探测式（toRoot 线索正则提取优先——managed→custom 半迁移时 customPath 未写入 sdk.json，测试抓出后补；退唯一非活动有内容根），盘面差异条目移回 + 反向 relink。以下为此前评估，留档：
>
> 2026-10-12（fix/issue-audit 批评估）：**留置**。修复面涉及 loadMigrationJournal 的 null
> 语义拆分（无文件 vs 损坏）+ boot 校准与 source-get 快照两处暴露 + 回滚兜底路径，超出
> 本小修批范围；真实发生率低（运行态记账文件损坏需盘故障/手改）。排期：SDK 来源批真机
> 验收时一并评估，若验收期无实际触发则降级为记录性 issue。

`loadMigrationJournal` 对损坏 JSON 返回 null（沿用 store 容错先例）。但 sdk-migration.json 是**运行态记账文件**而非偏好文件：若迁移中途文件损坏（盘故障/手改），恢复路径整体失效——崩溃恢复横幅不出现（snapshot.migration 为 null）、`assertSdkDomainOpen` 的内存标志也不会置位（boot 按盘面读到 null），半迁移状态（部分条目已移走）无人接管，设备启动会遇到组件缺失的通用报错。

**建议方向**：`loadMigrationJournal` 区分「无文件」与「有文件但解析失败」两种 null 语义；后者在 boot 校准与 source-get 快照中显式暴露（横幅提供「回滚」兜底——源根条目仍完整时回滚可行），或至少在快照里带 `journalCorrupted` 标记让设置页提示手动处置（删除 journal 前先回移条目）。

## 问题三：共享态的 ANDROID_USER_HOME / ANDROID_EMULATOR_HOME 落在共享根内（P3）

> **2026-10-12 resolved（fix/issue-audit 批）**：新增单源模块 `emulator/androidUserHome.ts`
> （恒定 `userData/android-user`，独立小模块避免 sdk.ts↔sdkSource 依赖环）；五处接线——
> sdk.ts sdkManagerEnv/bootstrap mkdir、devices 运行 env、avd/profiles/runner 参数化注入
> （缺省回落 SDK 根内旧布局保持模块纯净可测）。共享根不再落 android-user/；托管/自选态
> 该目录与 avd-home 同语义不随 SDK 根迁移（旧根遗留目录由迁移引擎按普通条目处理）。
> 回归：avd env 覆盖/缺省两用例。

`avd.ts:68-69`（avdmanager 创建设备）与 `devices/index.ts:196-197`（emulator 运行 env）把
`ANDROID_USER_HOME` / `ANDROID_EMULATOR_HOME` 指向 `<活动根>/android-user`。共享模式下活动根
= Studio SDK 根，于是**创建设备或启动模拟器会在 Studio SDK 根里创建 `android-user/` 目录**，
写入 avdmanager 元数据与 emulator 偏好/崩溃转储——与「共享根零写入」的严格口径有出入。
（`sdk.ts:361` 同样指向，但 sdkmanager 路径在共享态被 assertSdkWritable 拒绝，跑不到。）

对 Studio 本身实际无害：Studio 自身数据在 `~/.android`，SDK Manager 只扫描已知包目录、
忽略未知目录。但 emulator 的崩溃转储落在别人的 SDK 根里观感与归属都不对。

**建议方向**：android-user 一律改指应用数据目录（如 `userData/android-user`），与 avd-home
同层级——三处 env 单源成 `androidUserHomeFor()`；迁移引擎已把 `android-user` 当 SDK 根顶层
条目随根迁移，重定向后该条目自然消失于共享态、托管/自选态也可与 avd-home 一样恒定不迁。
登记于 2026-10-11 用户问询「共享对 Studio 的影响」时的代码核查。

## 问题四：source-adopt / source-migrate 缺「目标是 Studio SDK」的服务端复验（P3，防御缺口）

> **2026-10-12 resolved（fix/issue-audit 批）**：sdkSourceSwitch 增 `assertNotStudioRoot`
> （detection 缓存 ?? 现跑，`isStudioSdk` 同口径），source-migrate 与 source-adopt 两入口
> 在 toRoot 校验后复验并拒绝。回归：两条伪造载荷用例（拒绝且不建 journal、不翻 source、
> 不删落选根）。

`sdkSourceSwitch.ts` 的 `switchSource`（sdk:source-set 判定）在 L127-128 用 `isStudioSdk`
拒绝手选 Studio 路径（studio-path-use-shared），但 **`adoptSourceSwitch`（sdk:source-adopt）
与 `startSourceMigration`（sdk:source-migrate）没有各自复验**。正常 UI 流程不可达（判定先行
挡住、二选一卡不会为 Studio 路径出现），但这两个通道收 renderer 载荷——伪造
`{target:'custom', customPath:'<Studio SDK>'}` 可直接翻 source 或迁移替换进 Studio 根，
此后应用把它当**可写**自选根：卸载/下载/替换分支会真删真写 Studio 的 SDK。

与本功能自己定的口径不一致（「禁用态可被伪造入参绕过，双保险」——clear-retained 与
source-set 都做了服务端同拒）。登记于 2026-10-11 用户问询「应用内删 Studio 侧镜像的影响」
时的核查。

**建议方向**：两个入口在 resolve(toRoot) 后复用 `isStudioSdk` 复验并拒绝（错误词条同
studio-path-use-shared 的 main 侧措辞）；补两条伪造载荷单测。
