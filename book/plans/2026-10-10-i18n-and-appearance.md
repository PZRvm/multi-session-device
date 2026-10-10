---
description: 全应用三语 i18n（字典单源 + locale 持久化广播 + 三窗与主进程文案迁移）与设置窗外观接通，合并施工图共四批
status: completed
created: 2026-10-10
completed: 2026-10-10
---

# 全应用三语 i18n + 设置窗外观接通 — plan

> 单 plan 四批串行：批 1–3 为 i18n，批 4 为外观接通。原两份独立 plan（appearance-controls-live / i18n-full-app）于 2026-10-10 应用户要求合并为本文件；执行顺序由用户拍板 **i18n 先行、外观殿后**（设计阶段的推荐为外观先行，理由与影响已随批 4 说明）。每批独立走完实现—测试—验收，批间可停。本 plan 当前只含 workflow Step 0–2 产出；Phase 3 开工后逐批补实施结果。

依据：[PRD](../docs/PRD.md) §1 第 8 条、§2.3 E/G 与 AC「语言切换覆盖主窗口、设备向导、设置窗口与主进程对话框文案」、[stage05](../stage/05-功能完善.md) 设置窗 [suggested] 步骤、[静态前端 plan](./2026-10-09-settings-frontend.md)（控件已画、禁用；「字典统一提升至 `src/shared/i18n/`，不得保留两份运行期事实源」的边界）、[主题持久化 plan](./2026-10-06-theme-persistence.md)（持久化 + 广播先例，写链路已落地并真机验收）。

## Requirements brief — Step 0

### A. 全应用三语 i18n（批 1–3）

**背景。** 设置窗已有局部三语字典（`components/settings/copy.ts`，77 键 × 3 语），语言行静态禁用。全应用 UI 文案硬编码中文：renderer 非测试代码 36 个文件约 771 行含中文（DeviceWizard 113、DeviceEditor 52、DeviceRow 49、App 47…）；主进程约 200 条非测试 `throw new Error` 中文消息，其中会被 renderer 展示的（`toApiResult` 的 `result.error` 弹原生 dialog、`emitRuntimeError` 的运行时错误）对用户可见。主进程 dialog 模块只透传 renderer 组装的 options——「主进程对话框文案」实际由 renderer 侧字典覆盖，主进程侧要解决的可见文案是错误与运行时消息。

**范围。**

- Affects：
  1. `src/shared/i18n/` 单源字典体系：locale 类型上移、按消费域组织的三语字典、极简插值助手；
  2. 主进程新 locale 域：`userData/locale.json` 持久化、`locale:get-sync` 同步初值、`locale:set` 校验落盘、`locale:changed` 全窗广播、boot 建窗前恢复——完整镜像 theme 先例；
  3. renderer localeStore + `useCopy` 泛型 hook；
  4. 设置窗语言行接通（唯一写入口），设置窗自身三语实时切换；
  5. 主窗与向导窗 renderer 文案全量迁移；
  6. 主进程可见错误/运行时消息按当前 locale 出文案（协议不变：仍走 reject message，文本即目标语言）。
- Does NOT affect：主题域（批 4 只消费不动域）；SDK 来源、资源防线、危险区三个未接版面；IPC 协议形状（错误不引入错误码协议）；不引入任何 i18n 第三方依赖（自研同键字典，沿 copy.ts 先例）；不做 Intl 日期/数字格式化、RTL、复数/性别机器；不做按需加载（三语文本 KB 级，全量常驻）。
- Boundaries：一期语言闭集 `zh-CN | zh-TW | en-US`，缺键回退 zh-CN；插值仅 `{name}` 模板替换；「主进程可见文案」以「会被 renderer 展示」为圈定标准——纯主进程日志、内部 catch 后不上抛的字符串不动；无 legacy 收编需求（语言从未持久化过，无 localStorage 存量，故 locale store 无 fresh 标志，与 theme 不同）。

### B. 设置窗外观接通（批 4）

**背景。** 通用版面的外观三段按钮与三主题色色样已画、保持 `disabled`，选中态读静态预览模型。主题持久化链路（theme.json 单源、同步初值、全窗广播、跨窗 store 直写、原子落盘）已落地并真机验收；主窗顶部外观入口已按 2026-10-10 参考图调整隐藏——设置窗是外观唯一入口，而 themeStore 的 `setMode`/`setSystemId` 目前没有任何消费者。

**范围。**

- Affects：通用版面「外观」「主题色」两行控件接通 themeStore；点击即时生效；三窗经既有广播跟随；`SettingsViewModel.appearance` 扩出交互回调通道。
- Does NOT affect：界面语言行（批 1 已接通，本批不动）；模拟器/快捷键/关于/危险区四个版面；主进程 theme 域与 theme.json 结构（零改动预期）；主题 token 色值与 global.css；落盘失败的反馈 UI。
- Boundaries：失败语义沿用主题持久化 plan 的既定裁决——主进程内存先行，落盘失败降级为「本次会话生效、下次启动回退」，renderer 侧 console.error，不新增提示界面；选中态一律以 store（经广播回写）为准。

**顺序说明（用户拍板 i18n 先行的影响）。** 批 4 开工时 `PaneGeneral` 已在批 1 迁至 shared 字典、批 2 完成组件断言改造——外观批只做「启用控件 + 接回调」，不与文案迁移交叉；i18n 批 1 接通语言行时外观两行仍是禁用静态控件，两条子线在同文件内先后作业、无并行冲突。设计阶段曾推荐外观先行以「定型 PaneGeneral」，用户选择 i18n 先行后该顾虑由串行批次消化。

## Impact range — Phase 1

### 现状与可复用项

| 证据 | 当前事实 | 设计后果 |
| --- | --- | --- |
| `components/settings/copy.ts` + `model.ts` | 77 键三语字典 + `SettingsLocale` 类型，zhCN 为基准定义类型的模式已跑通 | 原样迁入 shared/i18n，模式照搬；`model.ts` 改 re-export，删除原文件 |
| `src/main/theme/`（store.ts / index.ts） | locale.json 可逐条镜像：无文件缺省、损坏缺省不覆写、tmp+rename 原子写、get-sync on+returnValue、set 校验→内存→落盘→广播 | locale 域照此先例实现，减 nativeTheme 相关步骤 |
| `src/preload/api/theme.ts` | sendSync 初值 + invoke set + onChanged 订阅三件套 | localeApi 同构 |
| `src/renderer/src/stores/themeStore.ts` | 初值取 preload、乐观 set + 落盘、模块级 onChanged 直写防成环 | localeStore 同构（无 fresh/收编段）；themeStore 的 `setMode`/`setSystemId` 已是完整写动作，批 4 直接消费 |
| `src/renderer/src/settings/SettingsApp.tsx` | 静态模型向 SettingsWindow 注入 appearance/locale（真实 store 值已合并） | 批 1 注入 locale + 回调；批 4 补外观回调，容器模式一致 |
| `src/renderer/src/components/settings/PaneGeneral.tsx` | 外观/主题色/语言三行控件全部 `disabled`，`aria-pressed` 读 model | 批 1 启用语言行；批 4 启用外观两行；标签与 aria 已三语齐备 |
| `src/main/theme/index.ts` | set 处理器已含校验→内存→nativeTheme→全窗底色→广播→落盘 | 批 4 主进程零改动 |
| `src/renderer/src/theme/index.tsx` | provider 消费 store 重算 CSS 变量 | i18n 不需要 provider——hook 直取字典即可重渲染 |
| `src/main/index.ts` boot | `restoreTheme().then(createMainWindow)` | `restoreLocale` 并列加入 whenReady 时序（无建窗参数依赖，仅内存态供错误文案用） |
| `src/main/dialog/index.ts` | 只透传 renderer 的 DialogOptions | 主窗/向导 dialog 文案随 renderer 字典自动三语 |
| `src/shared/settings-contract.ts` | 归一化 errors 为中文硬编码，经向导表单展示 | 属「会被 renderer 展示」范畴，归批 3（产出在 shared，消费在向导） |
| `components/__tests__/SettingsWindow.test.tsx` 等组件测试 | 断言中文字面量 + 「业务控件禁用」边界 | 批 2 改为经字典取词；「禁用」断言随批 1/批 4 逐行收缩到当批仍未接通的控件 |

### 风险与处理

| 风险 | 本轮设计处理 |
| --- | --- |
| 双事实源残留（copy.ts 未删或新字典旁路） | 批 1 即完成迁移 + 删除原文件；收尾 grep 断言无运行期引用 |
| 域间键冲突、三语键漂移 | 不做全局扁平命名空间，按消费域分记录（settings / mainWindow / wizard / errors）；类型层 `satisfies` 同型 + 每域「三语 Object.keys 全等」运行时测试 |
| 组件测试中文字面量大面积失效 | 批 2 视为迁移工作的一部分：断言一律经字典取词，工作量显式入 build order |
| 主进程 reject message 变目标语言，影响 console 排查 | 可接受并记录：错误文本随 locale 是 AC 要求；排查依赖结构化字段时再议错误码协议（超出本批） |
| locale:changed / theme:changed 广播成环 | 沿 themeStore 先例：各窗 store 直写，不经 setter 回写；发起窗同值幂等 |
| StrictMode 下事件回调双触发 | 写动作幂等（同值落盘无害、广播直写幂等）；断言最终状态而非调用次数 |
| 快速连续点击（批 4） | 不加节流：主进程 set 处理器顺序化，最后写胜出 |
| 主进程多窗口共享一个 locale | 主进程单例内存态即单一事实——所有窗口同一时刻同语言，无 per-window locale |
| 英文长文案挤坏布局 | 验收含最小窗三语视觉走查（静态 plan 已有 640px 检查经验可沿用） |
| `SETTINGS_PREVIEW.appearance` 残留被误当事实源（批 4） | preview 常量删除 appearance 字段；类型保持必填，由 SettingsApp 构造完整对象 |

## Design — Phase 2

### 1. shared/i18n 字典体系（批 1 起骨架，批 2/3 补域）

```text
src/shared/i18n/
  locale.ts       # SettingsLocale 上移（settings/model.ts 改 re-export）、SETTINGS_LOCALES、
                  # isSettingsLocale、DEFAULT_LOCALE = 'zh-CN'
  format.ts       # format(template, params)：{name} 替换，缺参原样保留（可单测）
  settings.ts     # 现 copy.ts 内容迁入：SettingsCopy + SETTINGS_COPY + LANGUAGE_OPTIONS
  mainWindow.ts   # 主窗域（批 2 产出）：BoardHead、设备行、画布、工具条、健康提示、App 弹窗标题…
  wizard.ts       # 向导域（批 2 产出）：创建/编辑窗全部文案
  errors.ts       # 主进程可见错误域（批 3 产出）：键 = 消息 id，值 = 可插值模板
  index.ts        # 汇出；类型模式沿 copy.ts——zhCN 为基准定义 Record 键型，其余语言 satisfies
```

消费方式：`COPY` 不做全局合并；各域导出 `Record<SettingsLocale, XxxCopy>`。renderer 侧一个泛型 hook 覆盖所有域：

```ts
// hooks/useCopy.ts
export const useCopy = <T>(domain: Record<SettingsLocale, T>): T => domain[useLocale()]
```

组件迁移 = 两处改动：import 来源换 `@shared/i18n`、取词行换 `useCopy(SETTINGS_COPY)` / `useCopy(MAIN_COPY)`——「组件持有一份同型记录消费」的现行用法不变。

### 2. 主进程 locale 域（批 1，镜像 theme）

| 项 | 设计 |
| --- | --- |
| `src/main/locale/store.ts` | `userData/locale.json`，schema `{ version: 1, locale: SettingsLocale }`；无文件 = zh-CN；损坏/非法 = 缺省起步不覆写；tmp + rename 原子写；内存态单源 |
| `src/main/locale/index.ts` | `restoreLocale()`（whenReady 建窗前调用，仅恢复内存态）；`registerLocaleIpc()`：`locale:get-sync`（on + returnValue，纯内存应答）；`locale:set`（handle：`isSettingsLocale` 守卫 → 内存 → 落盘 → 全窗广播，失败 reject） |
| 广播载荷 | `{ locale }` 对象，与 `ThemeSelection` 模式对齐，未来加字段不破协议 |
| `src/shared/ipc-channels.ts` / `types.ts` | `localeGetSync / localeSet / localeChanged` 三通道；`LocaleInitialState`、`LocaleSelection` 类型 |
| `src/preload/api/locale.ts` | `initial`（sendSync 一次）、`set`、`onChanged`；装配进 `preload/api/index.ts` |

主进程错误文案消费（批 3）：throw 点改为 `format(ERRORS_COPY[getLocale()][key], params)`——`getLocale()` 读内存态，格式化时取值，切换后新错误即新语言；历史已抛错误不追溯（对话框是即时呈现，无此需求）。

### 3. renderer 侧（批 1 落 store/hook 与语言行；批 2 全量迁移）

| 项 | 设计 |
| --- | --- |
| `stores/localeStore.ts` | 镜像 themeStore：初值 `window.api?.locale?.initial ?? { locale: 'zh-CN' }`；`setLocale` 乐观 set + `toApiResult` 落盘（失败 console.error，会话生效）；模块级 `onChanged` 直写防成环 |
| `hooks/useCopy.ts` | 上文泛型 hook |
| 语言行接通（批 1） | SettingsApp 注入 locale + `onLocaleChange`；`PaneGeneral` select 移除 disabled；`SETTINGS_PREVIEW` 删 locale 字段 |
| `lang` 属性 | SettingsWindow Wrapper 已有；批 2 给主窗 App 与向导 WizardApp 根节点补 `lang={locale}`（屏幕阅读与字体回退正确性） |

### 4. 设置窗外观接通（批 4）

`model.ts`：`SettingsViewModel.appearance` 扩为带回调的交互节点，其余字段不动：

```ts
export interface AppearanceModel {
  readonly mode: ThemeMode
  readonly systemId: ThemeSystemId
  readonly onModeChange: (mode: ThemeMode) => void
  readonly onSystemIdChange: (systemId: ThemeSystemId) => void
}
```

`SETTINGS_PREVIEW` 删除 `appearance` 字段（批 1 已删 locale；`sdk`/`resources`/`about` 保留，边界注释同步）。

`SettingsApp.tsx`：从 themeStore 多取 `setMode`/`setSystemId`（zustand selector，引用稳定），构造完整 appearance 节点传入 SettingsWindow。

`PaneGeneral.tsx`：外观三段按钮移除 `disabled`，`onClick={() => model.appearance.onModeChange(mode)}`；三个色样同理接 `onSystemIdChange`；`aria-pressed`、`aria-label`、图标、对勾与 `--swatch` 不变。语言行本批一行不改（批 1 已接通）。

主进程零改动：`theme:set-mode` / `theme:set-system-id` / `theme:changed` 既有链路已覆盖本批全部需求。

### 5. 文件清单（按批）

| 批 | 文件 | 工作 |
| --- | --- | --- |
| 1 | `src/shared/i18n/`（locale/format/settings/index） | 类型上移、format 助手、settings 域迁入 |
| 1 | `src/main/locale/`、`src/main/index.ts`、`src/main/ipc/index.ts` | locale 域 + boot + 注册 |
| 1 | `src/shared/ipc-channels.ts`、`src/shared/types.ts`、`src/preload/api/locale.ts`、`src/preload/api/index.ts` | 通道、类型、桥 |
| 1 | `stores/localeStore.ts`、`hooks/useCopy.ts`、`settings/SettingsApp.tsx`、`settings/PaneGeneral.tsx`、`components/settings/model.ts`（re-export、preview 收缩）、删除 `copy.ts` | 语言行接通 + 设置窗实时三语 |
| 2 | 主窗 17 个组件文件 + `App.tsx` + `wizard/` 组件 | 文案迁移 + 根节点 lang |
| 3 | `src/main/`（devices / emulator / scrcpy / window / dialog 等 throw 点）+ `src/shared/settings-contract.ts`、`shared/i18n/errors.ts` | 可见错误文案迁移 |
| 4 | `components/settings/model.ts`、`settings/SettingsApp.tsx`、`settings/PaneGeneral.tsx` | 外观类型扩展、preview 收缩、两行控件启用 |
| 各批 | 对应 `__tests__/` | 断言经字典取词；新增 store/IPC/hook/format/键齐/交互测试 |

## Build order — Phase 3（待执行，每批末尾全量回归 + 真机 + book 回写）

1. **批 1 i18n 骨架与设置窗切换**：shared/i18n + locale 域 + 桥 + store/hook + 语言行接通；验收：设置窗切语言即时三语、主窗与向导跟随（其文案未迁，仅 store 已切换）、重启保留、locale.json 损坏缺省起步。
2. **批 2 renderer 全量迁移**：主窗 + 向导文案迁入 mainWindow/wizard 域；组件测试断言改造；验收：三窗三语视觉走查（含 640px 最小窗英文长文案）、广播下语言切换三窗即时一致。
3. **批 3 主进程文案 + i18n 整步验收**：先盘点（grep 非测试 throw + emitRuntimeError 构造点，逐条判定是否被 renderer 展示，产出迁移清单）→ errors 域落地逐模块迁 → PRD §1 第 8 条与 §2.3 AC 逐条对。
4. **批 4 外观接通**：model 扩展 + SettingsApp 接线 + PaneGeneral 两行启用（测试先行）；验收：亮暗/主题色切换即时全窗生效、重启保留、六组合视觉走查、语言行不受影响。
5. 收尾：stage05 设置窗 [suggested] 步骤附批 1–4 结果（整步仍受 SDK/资源/危险区牵制保持未勾）、learn/issue 记录、plan 翻 completed、`npm run book:index`。

## Test plan — Phase 4（待执行）

- 单测：locale store（缺省/损坏不覆写/原子写内容/守卫拒绝）；IPC（非法 locale reject 且不落盘、get-sync 返回内存值、set 后广播）；format 插值与缺参；localeStore（无 preload 缺省不炸、乐观更新、onChanged 直写不成环）；useCopy 随 locale 重渲染；每域三语键齐性（Object.keys 全等）。
- 组件：语言行可交互且调用 onLocaleChange（批 1）；批 4 补外观段/色样点击回调与 aria-pressed 跟随；迁移组件断言全部经字典取词。
- 全量：每批 vitest、typecheck、lint、build 绿；lint 与存量基线比较不新增错误。
- 真机：PRD §2.3 AC 逐条——设置窗切三语，主窗、向导、设置窗文案即时跟随；触发一次运行时错误（如启动失败 dialog），文案随当前语言；重启保留语言；`locale.json` 手改损坏 → zh-CN 起步不崩，下次合法写入自愈；繁体/英文最小窗布局无横向溢出。批 4 追加：设置窗切亮/暗/跟随系统与三主题色，三处板面与原生三灯即时一致；切暗+雾蓝重启首帧无白闪（回归主题持久化验收）。

## 实施结果

### 批 1：i18n 骨架与设置窗语言切换 — 2026-10-10（已完成）

**实现**

- `src/shared/i18n/`：locale.ts（三语闭集 + 守卫 + 缺省 zh-CN）、format.ts（`{name}` 插值，缺参原样保留）、settings.ts（copy.ts 77 键 × 3 语原样迁入）、index.ts（单源出口）；`components/settings/copy.ts` 删除，运行期无残留引用；`model.ts` 的 `SettingsLocale` 改 re-export，`SETTINGS_PREVIEW` 删 locale 字段。
- 主进程 `src/main/locale/`：store.ts（locale.json 读写 + 容错 + tmp+rename 原子写 + 串行写队列，全沿 theme 先例）、index.ts（`restoreLocale` + `locale:get-sync` / `locale:set` / `locale:changed`）；boot 改 `Promise.all([restoreTheme(), restoreLocale()])` 先于建窗；IPC 注册接入 ipc/index.ts。
- shared：localeSet/localeGetSync/localeChanged 三通道；`LocaleSelection`/`LocaleInitialState` 类型（广播载荷 `{ locale }` 对象）。
- preload：localeApi 三件套（initial sendSync / set / onChanged），装配进 api。
- renderer：localeStore（镜像 themeStore，无 fresh/收编段）、`useCopy` 泛型 hook、SettingsApp 注入 locale + onLocaleChange、PaneGeneral 语言行启用（唯一写入口）、SettingsParts/SettingsWindow 字典来源换 `@shared/i18n`。

**验证**

- 全量 839 通过、6 项原有跳过；新增 shared 闭集/键齐/插值 7 项、locale store 7 项、locale IPC 13 项、localeStore 5 项、useCopy 1 项；设置窗测试改写——语言行交互断言新增，「业务控件禁用」边界收缩到语言行之外（外观两行/SDK/资源/危险区仍禁用）。typecheck、lint、build 通过。
- 真机 CDP（生产构建 + 9222 调试端口）：主窗齿轮开设置窗 → CDP 切 en-US，设置窗导航「通用」→「General」即时重渲染；locale.json 落盘 `{version:1, locale:"en-US"}`；退出重启后仍 en-US（重启保留）；手改损坏 `not-json{{{` → zh-CN 起步且原文件不被启动改写（容错）；随后合法写入自愈重写合法 JSON。测试后已删除 locale.json，恢复首启状态。

**范围与遗留**

- 主窗/向导文案未迁（批 2），主进程可见错误文案未迁（批 3），外观两行控件保持禁用（批 4）。批 1 无新增 issue。

### 批 2：renderer 全量文案迁移 — 2026-10-10（已完成）

**实现**

- 字典：`shared/i18n/mainWindow.ts`（主窗域 96 键）与 `wizard.ts`（向导域 131 键，含设置表单/画像页/镜像表/摘要/枚举标签），zh-CN 与原硬编码逐字一致，zh-TW/en-US 新译；`index.ts` 汇出。
- 组件迁移 16 个文件：主窗 App/BoardHead/DeviceListPane/DeviceHealthNotice/DeviceRow/DeviceCanvas/CanvasPlaceholder/DeviceToolbar/ResizeHandle + 向导 WizardApp/DeviceWizard/DeviceEditor/SettingsForm/ProfilePage/ImageTable/SummaryPanel，全部经 `useCopy(MAIN_COPY | WIZARD_COPY)` 取词；插值文案走 `format`（对账详情行、删除确认、设备行 aria、镜像行 aria、向导步进指示等）。枚举标签改为 helper 传字典（`networkSpeedLabels(copy)` 等），`FORM_FACTOR_LABELS`/`formatSize` 同改造。
- 根节点 `lang`：主窗 App Wrapper 与向导 WizardApp 包装层随 localeStore 注入。
- App 的运行时错误订阅与对账汇总 effect 以 `copy` 为依赖（语言切换后重建，新弹窗即新语言）；DeviceEditor `fieldLabels` 包 useMemo 稳定引用。
- 组件测试断言改造：14 个测试文件 UI 文案断言改为经字典取词（`copy.key` / `format(...)` / `new RegExp(...)`），夹具输入（注入错误、用户输入、it 标题）保留字面量。

**验证**

- 全量 839 通过、6 项原有跳过；typecheck、lint、build 通过。lint 过程修三处：SettingsForm 摄像头选择器还原为组件内普通函数（消 display-name）、DeviceEditor fieldLabels useMemo、App 对账 effect 补 copy 依赖。
- 真机 CDP（生产构建）：主窗初始「新建设备」+ `lang=zh-CN`；设置窗切 en-US 后主窗按钮广播跟随变「New device」；新开向导窗以 en-US 起步（heading「New device」、取消「Cancel」、`lang=en-US`）；切 zh-TW 主窗变「新建裝置」。测试后 locale.json 已清理恢复首启状态。

**范围与遗留**

- 主进程可见错误文案未迁（批 3），外观接通未动（批 4）。最小窗三语视觉走查未做像素级检查（CDP 文本验证为主），留待批 3 整步验收一并走查。批 2 无新增 issue。

### 批 3a：主进程可见文案（编辑/向导表单面）— 2026-10-10（已完成）

**实现**

- `shared/i18n/errors.ts`（41 键 × 3 语，zh-CN 与原硬编码逐字一致）：附加设置校验、向导能力禁用原因、编辑快照 note/warning、编辑路径高频 reject；`shared/i18n/index.ts` 汇出。
- main 取词助手：`src/main/locale/index.ts` 增 `msg(key, params)`——按 locale 域内存态格式化，boot 前调用回落 zh-CN。
- `shared/settings-contract.ts`：`normalizeAdvancedSettings` / `normalizeEditedSettings` / `sanitizeUpdateSettings` 增末位 `locale` 参数（缺省 zh-CN），校验错误与字段标签经 ERRORS_COPY 取词；main 调用点传 `getLocaleState()`，renderer 调用点（DeviceWizard/DeviceEditor）传自身 locale——表单红字随界面语言即时切换。
- `main/emulator/settings.ts`：WizardCapabilities 全部 disabledReason/quickBootDisabledReason/摄像头枚举错误经 msg()（ABI「跨架构镜像属二期」、皮肤「未找到可用皮肤」、朝向/Quick Boot 门槛）。
- `main/devices/index.ts`：编辑快照全部 note/warning（存储容量说明、config.ini 容量不一致、枚举/摄像头回显说明、摄像头跨设备绑定警告、配置差异提示）+ 编辑路径高频 reject（名称长度、指纹失效、附加设置不合法）经 msg()。

**验证**

- 全量 842 通过（新增 errors 域键齐性 + en-US 校验文案 2+1 项）、6 项原有跳过；typecheck、lint、build 通过。
- 真机 CDP：设置窗切 en-US → 打开既有设备编辑窗，存储说明呈「Internal storage … cannot change internal storage」、ABI 呈「Cross-architecture images are a later-phase item」，中文原文不再出现；页面残留中文仅 macOS 枚举的硬件摄像头名（系统数据，不属于文案）。测试后 locale.json 已清理。

**范围与遗留（3b 边界）**

- 未迁（3b，同 plan 继续执行）：`devices/index.ts` 设备生命周期 reject/lastError 长尾（启动/停止/删除/对账，约 60 条）、`emulator` 其余模块（sdk 下载/皮肤/avd/catalog/reconcile/displayCutout/adb/downloader）、`scrcpy`、`window/wizard`、`main/store.ts` 的可见消息；外部工具 stderr 透传段按「前缀可译、正文保留」处理。最小窗三语视觉走查随 3b 整步验收。

### 批 3b：主进程长尾全量迁移 — 2026-10-10（已完成）

**实现**

- errors 域扩容至约 290 键 × 3 语（zh-CN 与原硬编码逐字一致，繁/英新译），按模块分节：设备生命周期守卫与核验、编辑快照阻断、runner 运行故障、scrcpy 投屏、向导窗、store 健康、SDK 引导与许可对话框、sdk/下载器/AVD/画像/摄像头/皮肤导入/官方皮肤源/挖孔/adb/配置读写/目录扫描、对账（rc* 前缀 49 键）、退出清理对话框、摄像头仲裁提示、窗口标题、兼容性判定原因（compat* 前缀）。
- 调用点迁移 25 个主进程/shared 文件（两轮脚本 265+21 处替换全命中）：消息一律经 `msg(key, params)` 按内存 locale 取词；通道前缀守卫保留 `${channel}:` 排障锚点、后缀走字典；`shared/compatibility.ts` 增 locale 参数（renderer 传界面 locale、main 传 `getLocaleState()`），向导行内兼容性原因与创建守卫 reject 均随语言。
- 两处本地化敏感逻辑重构：devices 的摄像头建议从句检测 `cause.includes('请')` 改为多语言标记正则 `/[請请]|please/i`（ADVICE_RE）；`assertMetaWritable(label)` 的动作标签改经字典（actionCreate/Delete/Rename）。
- 保留原样：外部工具 stderr 透传正文（前缀已译）、`[devices]` 前缀 console 日志、`SdkImageProgress.message` 载荷标签（renderer 不展示，错误横幅用 error 字段）、macOS 枚举的硬件摄像头名（系统数据）。

**验证**

- 全量 843 通过（新增设置窗外观交互断言）、6 项原有跳过；typecheck、lint、build 通过。主进程既有断言全部原样通过（zh-CN 逐字策略生效）。
- 真机 CDP：设置窗切 en-US → 对不存在设备发起复制 serial，主进程 reject 为「Device not found (…)」英文文案。

### 批 4：外观三态 + 主题色接通 — 2026-10-10（已完成）

**实现**

- `model.ts`：`appearance` 扩为带 `onModeChange/onSystemIdChange` 的交互节点；`SettingsApp` 注入 themeStore 的 setMode/setSystemId（selector 引用稳定）；`PaneGeneral` 外观三段与主题色色样移除 disabled、接 onClick——主进程零改动，写链路复用主题持久化既有实现。

**验证**

- 全量 843 通过（外观段/色样点击回调与 aria-pressed 断言、通用版面边界收缩为「外观两行与语言行可交互」）；typecheck/lint/build 通过。
- 真机 CDP：切黑夜 → 设置窗与主窗 `--board-bg` 同帧变 `#101418`（广播跨窗跟随）；点雾蓝色样 → 选中态翻转、theme.json 落盘 `{systemId: mist, mode: dark}`；退出重启首帧即雾蓝暗色 `#11151a`（重启保留，无白闪路径复用主题持久化验收）。
- 附加调整（用户要求）：设置窗左侧分类栏上边距 32→46px，避开原生三灯。

## Done criteria

- 批 1：语言行可切换，设置窗自身即时三语，locale 域落盘/广播/容错符合设计，字典单源落位、`copy.ts` 无运行期残留。
- 批 2：主窗与向导全量三语，广播下三窗即时一致，最小窗布局无溢出。
- 批 3：PRD §1 第 8 条与 §2.3 AC 全条目可对——含主进程可见错误文案随语言。
- 批 4：外观三态与主题色可切换，即时全窗生效、重启保留、失败降级符合既定语义；预览模型不再承载外观事实。
- 整步：全量检查绿；stage05 设置窗整步保持未勾（SDK、资源防线、危险区未接），本 plan 仅收口 i18n 与外观两个子项。
