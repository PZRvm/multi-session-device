---
description: 共享 Studio SDK 模式的向导收窄设计——画像页只显示与已装镜像匹配的设备、镜像区只列已装 API（无服务筛选/完整列表/Preview/不支持开关与下载卸载按钮）、清单本地化与指路 Studio 空态；托管/自选完全不变
status: completed
created: 2026-10-12
---

# 共享模式向导只显示已装镜像 — plan

覆盖 [stage05](../stage/05-功能完善.md)「SDK 来源设置」步骤的共享模式向导收尾批：**仅当 SDK 来源 = 共享 Android Studio SDK 时**——①新建设备的画像列表只显示「有已装镜像可用」的设备画像；②API 版本页只显示已安装的 API，去掉服务筛选 combobox、完整列表 / Preview / 不支持项三开关与下载 / 卸载按钮。托管 / 自选模式向导完全不变。**本 plan 承接并关闭 [issue 2026-10-11 问题一](../notes/issue/2026-10/2026-10-11-sdk-source-shared-wizard-guide-and-journal-corruption.md)（共享向导缺包引导 UI）。**

依据：[SDK 来源 plan](./2026-10-11-sdk-source-switching.md)（共享只读语义与守卫已落地）、[调研 think-report 20261009022552](../notes/think-report/20261009022552-SDK共享检测与真机投屏.md) 假设 3（向导只用已装镜像，缺包引导回 Studio）、[PRD](../docs/PRD.md) §2.3 C/D（本批需修订镜像选择 AC 的共享例外）。

## Requirements brief — Step 0

### Background

共享模式下 SDK 恒只读：镜像下载 / 卸载已被 main 守卫拒绝（`assertSdkWritable` → 指路 Studio 词条），但向导 UI 未随来源收窄——画像页把全部画像列出来（选了才发现没镜像可用），镜像页仍展示六源 manifest 全量目录与下载按钮（点了才报错）。用户要求共享模式下向导按「已装什么给什么」收窄，不再需要为全量目录服务的筛选与开关。

### Scope

- Affects：向导画像页与镜像表在共享态的渲染收窄、镜像清单通道的共享态本地化（跳过六源 manifest 拉取）、`ImageCatalogResult` 附带来源标记、共享态空态与指路 Studio 的引导文案（三语）、PRD 镜像选择 AC 的共享例外修订。
- Does NOT affect：托管 / 自选模式的向导任何行为（全量目录、下载、卸载、筛选开关原样）；main 侧共享只读守卫（已落地，本批只是 UI 跟上）；设备创建 / 启动 / 编辑链路（编辑窗镜像身份恒不可改）；皮肤导入 / 下载（写应用数据目录，共享态本就允许）；SDK 来源切换与迁移（plan 2026-10-11 已交付）。
- Boundaries：共享态判定只以 main 的 sdk.json 为准（renderer 不自判）；过滤是**展示层**行为——创建资格的最终守卫仍在 main（兼容性 + 已装核验），UI 收窄不承担安全职责；Studio 侧装 / 删镜像后，向导重开（或重拉清单）即见变化——不做目录监听。

### Requirement（用户三条 → 设计锚点）

| 用户要求 | 设计落点 |
| --- | --- |
| 画像列表只显示已装 API 对应的设备 | renderer 用 @shared 兼容纯函数过滤：画像保留条件 = 存在已装镜像使 `assessImageCompatibility` 判 supported；空类别从导航隐藏；附「已按已装镜像过滤」提示行 |
| API 页只显示已安装的 API，不需要 combobox / 完整列表 / Preview / 不支持项过滤 | 镜像表共享形态：仅 已装∧supported 行；隐藏服务筛选 select、三开关、下载与卸载按钮；仅一行时自动选中 |
| 仅共享 Studio SDK 时生效 | `ImageCatalogResult.sdkSource` 由 main 填充，向导据此分支；managed / custom 分支零改动 |

## Impact range — Phase 1

### 现状证据

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| [ProfilePage.tsx:49-59](../../src/renderer/src/components/wizard/ProfilePage.tsx) | 画像行过滤只看 类别/弃用/搜索，完全不感知镜像 | 共享过滤在 DeviceWizard 层算好 eligible 集合再传入（组件接口加一个可选过滤结果，或上游直接传过滤后的清单） |
| [ImageTable.tsx:61-77](../../src/renderer/src/components/wizard/ImageTable.tsx) | 行过滤 = 服务筛选 + Preview + 不支持开关 + 推荐窗口（最近五个正式 major） | 共享态换一条行过滤（已装∧supported）并隐藏整条 toolbar 与行内下载 / 卸载钮 |
| [DeviceWizard.tsx:151-175](../../src/renderer/src/components/DeviceWizard.tsx) | 画像与镜像清单挂载即并发拉取（`profiles()` + `images()`），兼容判定 [423-429](../../src/renderer/src/components/DeviceWizard.tsx) 用 @shared 纯函数逐镜像算 | 画像页过滤所需的镜像数据在页面渲染前已就绪（共享过滤以 images.phase === 'ready' 为前提） |
| [DeviceWizard.tsx:449-465](../../src/renderer/src/components/DeviceWizard.tsx) | 完成门槛 = 已装 ∧ verdict supported ∧ 名称合法 | 共享态过滤后的行天然满足前两条，门槛不改 |
| [catalog.ts:600-629](../../src/main/emulator/catalog.ts) | `fetchImageCatalog` = 六源 manifest 拉取 + `scanLocalImages` 本地核验合并；`ImageEntry` 的 zipUrl/sizeBytes 本地-only 恒 null | 共享态走 local-only 路径：跳过 manifest 拉取（离线可用、秒回），类型无阻碍 |
| [types.ts:739-748](../../src/shared/types.ts) `ImageCatalogResult` | 无来源字段；向导不知道当前 source | 加 `sdkSource: SdkSourceMode`（main 的 sdkImages handler 填充） |
| [@shared/compatibility.ts](../../src/shared/compatibility.ts) | `assessImageCompatibility`（ABI/形态服务匹配/画像 API 范围/Preview）main 与 renderer 同源 | 画像可用性判定复用它，不新造第二套兼容语义 |
| 守卫现状 | 共享态下载 / 卸载 / bootstrap 被 `assertSdkWritable` 拒（指路 Studio 词条） | UI 收窄后按钮不可见，守卫保留为伪造路径兜底——双层不动 |

### 风险与处理

| 风险 | 处理 |
| --- | --- |
| 画像被隐藏后用户困惑「少了一半设备」 | 页顶提示行带隐藏计数（「已按已装镜像过滤（隐藏 N 个不匹配画像）」），回应 PRD「不静默隐藏」的精神 |
| Studio 侧装 / 删镜像后向导不刷新 | 重开向导或重拉清单即见（60s 缓存自然过期）；不做目录监听（一期边界写明） |
| 共享根一个可用镜像都没有 | 画像页空态引导：「共享 SDK 中没有已安装镜像——去 Android Studio SDK Manager 安装或切换来源」；类别导航整排隐藏 |
| `unknown` / `desktop` 形态画像 | 兼容判定恒 unknown / 无镜像 → 共享态自然全部隐藏，无需特判 |
| renderer 伪造 sdkSource 影响判定 | 过滤纯展示；创建资格在 main（兼容 + 已装核验 + requireSdkReady），伪造不产生越权 |

## Design — Phase 2

### 1. 来源标记传递（类型与 main）

`ImageCatalogResult` 增加 `sdkSource: SdkSourceMode`（`'managed' | 'custom' | 'shared-studio'`）。`sdk:images` handler 填 `getSdkSourceState().source`。向导从镜像清单资源读一次即得分支——不加新通道，`sdk:profiles` 保持模式无关（单一事实源在 main，展示过滤在 renderer）。

### 2. 共享态镜像清单本地化

`listImagesWithState(root)` 增加可选 `{ localOnly?: boolean }`：为真时跳过六源 manifest 拉取，直接 `scanLocalImages` 产清单（`sourceWarnings: []`、`offline: false` 语义改为「未尝试远程」——沿用 offline 字段不新增）。`sdk:images` handler 在 `isSharedReadOnly()` 时传 localOnly。收益：共享向导离线可用、秒级响应；语义与只读一致（远程目录在共享态永远用不上）。

### 3. 画像页过滤（共享态）

新纯函数进 [@shared/compatibility.ts](../../src/shared/compatibility.ts)（与 assessImageCompatibility 同居，main / renderer 可共用）：

```ts
/** 共享态画像可用性：存在已装镜像使兼容判定为 supported（ABI/形态/API 范围/Preview 全过） */
export const profileHasSupportedImage = (
  profile: Pick<DeviceProfile, 'formFactor' | 'apiMin' | 'apiMax' | 'creatable'>,
  images: Array<Pick<ImageEntry, 'abi' | 'services' | 'api' | 'installed'>>,
  locale?: SettingsLocale
): boolean
```

DeviceWizard 层：`sharedMode = catalog.sdkSource === 'shared-studio' && images.phase === 'ready'`；`eligible = profiles.filter(p => profileHasSupportedImage(p, images.data))`。共享态把 `eligible` 传给 ProfilePage，并：

- 类别导航隐藏 eligible 计数为 0 的类别（含 unknown / desktop 的自然消失）；
- 页顶提示行：「共享模式：已按已装镜像过滤（隐藏 N 个不匹配画像）」，N = 全量 − eligible；
- `images.data` 为空（共享根无任何已装镜像）：整个画像区换空态引导（见 §5 词条），类别导航与搜索隐藏；
- managed / custom：传全量，行为逐字节不变。

过滤交互契约不变：搜索只过滤不选中、切类别清不属于该类的选择、行 role=button 可键盘操作（沿 ProfilePage 既有契约）。

### 4. 镜像表共享形态（ImageTable）

新增 prop `sharedMode: boolean`（默认 false）。为真时：

- **行过滤**：`installed === true ∧ verdict.status === 'supported'`（本地化清单天然已装，判定保留双条件以独立于清单形态）；排序沿用现有顺序；
- **隐藏**：toolbar 的服务筛选 select、完整列表 / Preview / 不支持项三开关（`ImageFilters` 状态在共享态不初始化也无妨——组件内部分支不渲染即可）；
- **隐藏**：行内下载按钮、卸载按钮与相关 spinner / 恢复逻辑入口（下载 / 卸载状态机仍由 DeviceWizard 持有，共享态不会触发）；
- **新增**：表格上方一行提示（见 §5 词条）；仅一行时自动选中（managed 态不自动选，行为差异写进组件注释）。

```text
| 共享 Android Studio SDK：已装镜像 3 个——安装/删除请到 Android Studio      |
| API 34 · Google Play        (x) 已安装                                     |
| API 34 · Google APIs        ( ) 已安装                                     |
| API 30 · Google APIs        ( ) 已安装                                     |
```

### 5. 词条（wizard 域，三语）

- `sharedModeImagesHint`：『共享 Android Studio SDK：已装镜像 {count} 个——安装 / 删除请到 Android Studio』
- `sharedModeFilteredProfiles`：『已按已装镜像过滤（隐藏 {count} 个不匹配画像）』
- `sharedModeNoImages`：『共享 SDK 中没有已安装镜像：请在 Android Studio 的 SDK Manager 安装系统镜像，或到设置切换 SDK 来源』

### 6. 文件清单

| 文件 | 工作 |
| --- | --- |
| `src/shared/types.ts` | `ImageCatalogResult.sdkSource` |
| `src/main/emulator/catalog.ts`、`src/main/emulator/index.ts` | localOnly 路径 + sdkImages handler 填 source（共享态传 localOnly） |
| `src/shared/compatibility.ts` | `profileHasSupportedImage` 纯函数 |
| `src/renderer/src/components/DeviceWizard.tsx` | sharedMode 分支、eligible 计算、props 下传 |
| `src/renderer/src/components/wizard/ProfilePage.tsx` | eligible 过滤（可选 prop）、零类别隐藏、过滤提示行、空态引导 |
| `src/renderer/src/components/wizard/ImageTable.tsx` | sharedMode 形态（行过滤 / 隐藏 toolbar 与下载卸载 / 自动选中 / 提示行） |
| `src/shared/i18n/wizard.ts` | 三词条 ×3 语 |
| `book/docs/PRD.md` | §2.3 C/D 的镜像选择 AC 加共享例外（只显示已装；无筛选开关与下载入口） |

## Build order — Phase 3

1. **文档前置**：PRD AC 修订；本 plan 挂 stage 步骤 51；issue 问题一标注「由本 plan 承接」。
2. **契约与纯函数**：`ImageCatalogResult.sdkSource` + `profileHasSupportedImage` + 单测（形态不匹配 / API 范围外 / x86 已装 / Preview 已装均判不可用；phone + google_apis 已装判可用）。
3. **main 清单**：localOnly 路径 + handler 接线（共享态）+ catalog 单测（localOnly 不触 manifest 接缝、source 字段填充）。
4. **画像页**：eligible 过滤 + 零类别隐藏 + 提示行 + 空态引导 + 组件测试。
5. **镜像表**：sharedMode 形态 + 自动选中 + 组件测试；DeviceWizard 集成分支测试（共享：无 combobox / 无下载钮 / 只列已装；managed：回归不变）。
6. 全量验证（typecheck / lint / 全量测试 / build）+ book 收尾（stage 附注、issue 问题一处置记录、索引）。

## Test plan — Phase 4

- 单测：`profileHasSupportedImage` 全维度（含 installed=false 不算、unknown/desktop 形态恒 false）；catalog localOnly（manifest fetcher 接缝零调用、sourceWarnings 空、sdkSource 填充正确）。
- 组件（jsdom）：共享态画像页——不匹配画像不出现、空类别导航不出现、提示行含隐藏计数、无镜像空态文案；共享态镜像表——无服务筛选 select / 三开关 / 下载钮 / 卸载钮，行 = 已装∧supported，单行自动选中且完成门槛可达；托管态——现有向导测试全量回归零改动。
- 真机（用户验收）：切共享 → 开新建设备，确认画像只剩已装 API 可用的、API 区只有已装项且无筛选与下载入口；Studio 侧装一个新 API → 重开向导即见；Studio 侧删镜像 → 重开即消失且对应设备启动被拦。

## Done criteria

共享态向导「所见即可建」：画像列表与 API 列表全部可完成创建（无点了才报错的路径）；托管 / 自选行为与现状逐字节一致（既有向导测试零改动全绿）；三语文案齐；PRD / stage / issue（问题一关闭）/ 索引同步；全量测试、typecheck、lint、build 通过。

## 设计轴批复 — 2026-10-12（用户逐条确认，人话复核后全批）

- [x] 共享态 `sdk:images` 走**本地核验清单**（跳过六源 manifest）：离线可用、秒回；远程目录共享态本就装不了。
- [x] 画像过滤在 **renderer**（@shared 纯函数），`sdk:profiles` 通道保持模式无关；页顶提示行带隐藏计数（不静默隐藏）。
- [x] 镜像表共享态**仅一行时自动选中**；managed 态不自动选。
- [x] 共享态隐藏**空类别**的导航按钮；搜索框保留。

## 实施记录 — 2026-10-12（批 1–6 完成，真机验收待做）

- **批 1**：PRD §2.3 C/D 的画像与镜像 AC 加共享例外；plan 挂 stage、issue 问题一标注承接。
- **批 2**：`ImageCatalogResult.sdkSource?`（catalog 模式无关，handler 填充）+ `@shared/compatibility.profileHasSupportedImage`（复用 assess 全维度）+ 4 项单测。
- **批 3**：`fetchImageCatalog/listImagesWithState` 增 `{ localOnly }`（共享态跳六源 manifest，离线可用）+ `sdk:images` handler 共享态接线、sdkSource 每次新鲜填充（缓存命中不陈旧）+ localOnly 单测（fetcher 零调用、本地核验条目透出）。
- **批 4**：ProfilePage 新 props（hideEmptyCategories / filterNote / emptyNote）：无镜像整页空态、零类别隐藏、列表区顶部过滤提示行（含隐藏计数）。
- **批 5**：ImageTable `sharedMode`——行过滤 已装∧supported、工具条换「已装镜像 N 个——安装/删除请到 Android Studio」提示行、隐藏服务筛选/三开关/下载/卸载；DeviceWizard 接线（sdkSource 捕获、eligible 画像、单行自动选中 effect）。
- **批 6**：向导测试 +4（画像过滤与提示、镜像页收窄与自动选中、空态引导、managed 回归）；夹具坑：本测试文件 `image()` 工厂默认 `installed: true`——共享用例需显式造未装条目。
- 验证：全量 1052 项通过（6 项原有跳过）、typecheck/lint/build 通过。
- **未做**：真机验收（切共享看收窄效果、Studio 侧装/删镜像重开向导即见、共享下完成一次创建）；plan 完成判据里的用户验收项。
- **2026-10-13 用户真机验收通过**：共享态收窄走查——向导只见已装可用画像与镜像、下载/卸载入口收窄确认、Studio 侧装删镜像重开向导即见/即隐、共享下完成创建（此前批次已覆盖）。本 plan 翻 completed。
- **2026-10-12 追加（用户指示）**：设置页删除与「SDK 来源」重复的「SDK 目录」板块——行内化：托管/共享/自选选中态在选项行内显示路径，共享附「重新检测」、自选附「更换路径…」（均触发原目录板块等价流程）；清理死键、path-line 样式；相关测试同步改点。
