---
description: Windows 主窗和设置窗移除系统标题栏，将透明图标、标题与原生窗口按钮融入应用顶部，Logcat 开关位于窗口按钮左侧
status: completed
created: 2026-11-02
---

# Windows 窗口顶部适配

用户于 2026-11-02 授权在 feature/windows-titlebar-adaptation 工作区执行本计划，基分支 dev，开发端口 6175。Step 0、阶段 1 和阶段 2 已完成，按下方顺序进入实现。

## Requirements brief（Step 0）

- 背景：Windows 现在保留独立系统标题栏，应用内已有板头与右上工具入口。需要把窗口标识和控制按钮融入应用界面，减少顶部的分层。
- 需求：Windows 主窗左上显示透明图标和应用标题；右上依次是 Logcat 开关、最小化、最大化/还原、关闭。设置窗左上显示同一图标和“设置”，右上放同样的窗口控制区。
- 作用域：主窗、设置窗的 Windows 建窗选项、顶部布局、原生按钮主题同步，以及对应测试和文档。
- 排除项：macOS、Linux 的窗口配置与视觉布局；向导、设备编辑、报告、无线连接、独立 Logcat 窗口；设备业务、日志订阅/弹出/贴回规则、录屏业务、图标生成、打包配置和依赖。
- 边界：“tab 栏”按当前代码中的独立系统标题栏理解，不新增标签页或标签切换；应用保留一行 40px 的顶部操作区。只对 `win32` 启用新方案。
- 设置窗能力：按“设置页面也一样”的要求，Windows 开启最小化，保持可调整尺寸并支持最大化/还原；macOS 的 `minimizable: false`、`fullscreenable: false` 保持原值。最大化不等同于全屏，本次不开启设置窗全屏。
- 验收：无独立系统标题栏；图标无底板；按钮与标题不遮挡；Logcat 开关始终在整个主窗的窗口控制区左侧；原有开关和窗口关闭流程继续有效。

设计补充：保留拖动、双击顶部最大化/还原、窗口缩放和键盘系统操作；处理浅色/深色/跟随系统、三套主题、窄左栏、英文长标题与 Windows 显示缩放。权限与数据模型不变，无新增通知、持久化字段或 IPC。

## Impact range（阶段 1）

### 当前实现

| 位置 | 当前行为 | 本次影响 |
| --- | --- | --- |
| `src/main/window/index.ts` | 仅 macOS 配置 `hiddenInset`，Windows 使用系统标题栏 | Windows 改为隐藏标题栏并启用原生按钮覆盖层 |
| `src/main/window/settings.ts` | Windows 使用系统标题栏，所有平台禁用最小化 | Windows 隐藏标题栏、启用覆盖层和最小化 |
| `src/renderer/src/components/BoardHead.tsx` | 左栏 40px 板头；macOS 留三灯位置，其余平台不显示标题 | Windows 加透明图标与应用名，保留外观、设置和设备计数 |
| `src/renderer/src/App.tsx` | BoardHead 在左栏；Logcat 开关与录屏状态位于画布右上 | Windows 顶部横跨整个窗口，Logcat 开关移入顶部右侧 |
| `src/renderer/src/components/SettingsWindow.tsx` | macOS 有绝对定位拖拽区，导航顶部统一留 46px | Windows 增加顶部标识行，单独调整导航留白 |
| `src/main/theme/index.ts` | 建窗及主题切换时同步窗口底色 | 增加两个目标窗口的原生按钮颜色同步 |
| `resources/icon-windows.png` | 已有 Windows 专用透明图标，关于页已使用 | 直接引用，不修改资源 |

数据流：主进程平台判定决定建窗样式；主进程主题状态决定覆盖层颜色；renderer 从既有平台值和语言字典生成图标、标题与布局；Logcat 继续调用原来的 `handleToggleLogDock`。

### 风险与处理

- 原生按钮覆盖 HTML：用 Window Controls Overlay 的安全区尺寸布局，不能只按“三个按钮约 138px”硬编码。
- 日志 dock 展开后最右侧属于日志栏：顶部必须独立于画布和日志栏，开关不能继续定位在 `.canvas-area` 内。
- 左栏最窄为 220px：图标和操作控件不压缩，标题单行省略并提供完整 `title`，不能挤掉设置入口和计数。
- 去掉系统标题栏后可能失去拖动或按钮被拖拽区吞掉：空白区允许拖动，所有 HTML 交互控件标记 `no-drag`，分栏把手从正文起算。
- 主题变化只更新页面会造成按钮色块残留：建窗首帧、主题色切换、亮暗切换和系统外观变化都同步覆盖层。
- jsdom 不绘制系统按钮：单测验证配置、分支和行为，真实 Windows 窗口验证几何、命中与系统交互；macOS 真机回归结果单独记录，不以平台桩代替。

## Design（阶段 2）

### 1. 采用原生窗口按钮覆盖层

选择 `titleBarStyle: 'hidden'` + `titleBarOverlay`。标题和背景由应用绘制，最小化、最大化/还原、关闭由 Electron 的原生覆盖层提供，覆盖层高度与应用顶部统一为 40px。

备选是 `frame: false` 加自绘按钮，但需新增控制 IPC、最大化状态同步和额外的系统行为适配；本次不采用。保留系统标题栏则无法满足移除独立标题栏的要求。

Electron 官方说明支持隐藏标题栏后启用原生窗口按钮，并通过 CSS 环境变量避让按钮：[自定义标题栏](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)。本地安装的 Electron 类型也已包含 `titleBarOverlay`、`setTitleBarOverlay`，实施无需升级依赖；仍须用本项目实际 Electron 版本做真窗验证。

Windows 建窗配置形态：

```ts
{
  titleBarStyle: 'hidden',
  titleBarOverlay: { height: 40, color, symbolColor }
}
```

仅 `win32` 使用以上配置；macOS 原 `hiddenInset` 和 `trafficLightPosition` 分支保持原样；Linux 继续使用现有配置。保留 `BrowserWindow.title`、`icon` 和 `page-title-updated` 守卫，任务栏、Alt+Tab 与页面标题栏相互独立。

### 2. 主窗布局

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 透明图标 应用标题  外观 设置 设备数        空白拖拽区     Logcat │ ─ │ □ │ × │
├───────────────────────┬───────────────────────────────────────┬──────────────┤
│ 设备列表              │ 投屏工作台                            │ 日志 dock    │
│                       │                                       │ （可收起）   │
└───────────────────────┴───────────────────────────────────────┴──────────────┘
```

- Windows 将现有 BoardHead 移至全宽顶部行的左端，宽度跟随 `listWidth`；其他平台仍在左栏原位置渲染，不重复挂载。
- BoardHead 仅在 Windows 增加 `resources/icon-windows.png`（24×24、`object-fit: contain`、无背景/底板）和 `MAIN_COPY[locale].appName`。图标为装饰图，`alt=""`；标题使用现有字体和主题 token，不改品牌文案。
- 应用名 `min-width: 0`、可收缩、单行省略；右侧现有外观选择器、设置按钮、设备计数保持行为和尺寸。
- 顶部行剩余区域为拖拽空间，最右的 HTML 控件是原来的 Logcat 开关；它位于原生按钮安全区的右缘，保留约 10px 间距。
- 安全区优先使用 `env(titlebar-area-x, 0px)`、`env(titlebar-area-width, calc(100% - 138px))`；138px 仅用于环境变量不可用时的初始保守退让，真实窗口以覆盖层提供的几何信息为准。
- `App` 新增正文容器 `.workspace`。Windows 外层纵向排列“40px 顶部 + 剩余正文”，正文保留现有横向分栏；其他平台该容器用 `display: contents` 保持现有布局。正文 `flex: 1; min-height: 0`，canvas、日志栏和分隔条统一从顶部行下方开始。
- Windows 不再在 `.canvas-tools` 中渲染第二个 Logcat 开关；`logTarget` 的显隐条件、`aria-pressed`、提示文案和点击处理函数原样复用。无日志目标时，顶部保留拖拽空间和窗口按钮。
- 录屏状态仍在画布工具区。顶部已从正文流中分离，录屏状态、投屏内容和日志工具栏不会进入原生按钮区域。

### 3. 设置窗布局

```text
┌───────────────────────────────────────────────────────────┐
│ 透明图标 设置                       空白拖拽区 │ ─ │ □ │ × │
├──────────────┬────────────────────────────────────────────┤
│ 分类导航     │ 当前设置内容                               │
└──────────────┴────────────────────────────────────────────┘
```

- 仅 Windows 在 `.body` 前增加 40px 顶部行，左侧图标规格与主窗一致；标题复用 `ERRORS_COPY[model.locale].settingsWindowTitle`，随现有语言状态变化，不另建字典。
- 右上三个按钮由同一原生覆盖层提供，不增加 HTML 控制按钮。
- Windows 导航顶部 padding 从 46px 改为 12px，避免顶部行加入后重复留空；macOS 的 32px 拖拽区、46px 导航 padding 及原生三灯保持原样。
- 保留 176px 导航宽度、原有分类顺序、右侧滚动与窄窗设置行规则。760×560 默认尺寸、640×460 最小尺寸保持不变。
- Windows `minimizable` 改为 `true`，显式保证 `maximizable: true`；其余平台沿用原能力。关闭仍走窗口现有生命周期，不调用 `destroy()` 或 `app.quit()` 绕过流程。

### 4. 主题和窗口生命周期

在现有 `src/main/theme/index.ts` 内完成，不建立通用窗口控制框架：

- 增加 `themeWindowTitleBarOverlay()`，由 `getThemeState()`、`resolveThemeMode()`、`THEME_SYSTEMS` 派生 `{ height: 40, color: tokens.bg, symbolColor: tokens.ink }`。
- 增加 `registerWindowTitleBar(window)`，只在 Windows 为主窗和设置窗登记一个 `WeakSet<BrowserWindow>` 标记；非 Windows 不登记。
- 两个建窗入口先使用颜色配置创建窗口，再登记标记，首帧即与主题一致。
- 既有 `refreshWindowBackgrounds()` 保持全窗底色刷新，并且仅对已登记窗口调用 `setTitleBarOverlay()`。主题模式、主题色及 system 模式的系统外观变化继续复用既有刷新入口。
- WeakSet 不持有已销毁窗口；刷新仍遍历 `BrowserWindow.getAllWindows()`，不会向独立日志窗、向导等未启用覆盖层的窗口调用该方法。不新增主题监听或 IPC。

### 文件改动清单

| 文件 | 改动 |
| --- | --- |
| `src/main/window/index.ts` | Windows 主窗配置、登记覆盖层 |
| `src/main/window/settings.ts` | Windows 设置窗配置、登记覆盖层、最小化/最大化能力 |
| `src/main/theme/index.ts` | 覆盖层颜色派生、登记、随既有主题刷新 |
| `src/renderer/src/App.tsx` | Windows 全宽顶部、Logcat 位置、正文容器与平台样式 |
| `src/renderer/src/components/BoardHead.tsx` | Windows 透明图标、应用名、窄宽度省略 |
| `src/renderer/src/components/SettingsWindow.tsx` | Windows 图标和设置标题行、导航顶部留白 |
| `src/main/window/__tests__/index.test.ts`（新增） | 主窗平台建窗配置与覆盖层登记 |
| `src/main/window/__tests__/settings.test.ts` | 设置窗分平台能力及原生命周期回归 |
| `src/main/theme/__tests__/index.test.ts` | 首帧颜色、主题刷新及未登记窗口不受影响 |
| `src/renderer/src/components/__tests__/BoardHead.test.tsx` | Windows 标识、现有操作、macOS/Linux 分支 |
| `src/renderer/src/components/__tests__/App.logcat.test.tsx` | Windows 开关位置和既有 dock 行为 |
| `src/renderer/src/components/__tests__/SettingsWindow.test.tsx` | Windows 标题与平台差异 |
| `DESIGN.md` | 实现后补 Windows 顶部布局和设置窗平台差异 |

`src/shared/i18n/`、preload、IPC 契约、图标资源与 ResizeHandle 本体无需改动。

## Build order

以下为实现顺序，每项完成后执行对应验证。

1. [x] 为主窗、设置窗补平台配置测试，覆盖 `win32` / `darwin` / `linux`；为主题域补登记窗口与普通窗口混合的测试。先确认新 Windows 断言因现状未实现而失败，现有 macOS/Linux 断言有效。
2. [x] 在主题域实现覆盖层配置和登记，再接入两个建窗入口。Windows 设置窗启用最小化/最大化；验证配置测试、原设置窗单例/失败/重开测试和主题测试。
3. [x] 补 BoardHead 与 App 的 Windows 用例，再实现透明图标、应用名、全宽顶部和正文布局。迁移 Logcat 按钮的渲染位置并复用处理函数；验证开启、关闭、弹出、贴回及选中目标变化。
4. [x] 补设置窗 Windows 用例，再实现图标、设置标题和平台化留白。验证分类、语言、滚动、关于页与 macOS 原拖拽区。
5. [x] 执行阶段 4 的自动检查和 Windows 真窗验收；有失败先定位再在实现/测试阶段修复，验证通过后再进入评审。
6. [x] 阶段 5 按 `book/guidelines/review-checklist.md` 评审最终 diff；发现问题只记入 `book/notes/issue/2026-11/`，不在评审阶段顺手修。
7. [x] 阶段 6 更新 `DESIGN.md`，写 `book/notes/summary/2026-11/` 功能报告；有新经验写 learn，未修问题写 issue。达到完成条件后将本计划改为 `completed`，运行索引与卫生检查。新增目录时补 `scripts/gen-book-index.mjs` 用途表。

## Test plan（阶段 4）

### 自动检查

针对上述六个测试文件执行：

```sh
npm test -- src/main/window/__tests__/index.test.ts src/main/window/__tests__/settings.test.ts src/main/theme/__tests__/index.test.ts src/renderer/src/components/__tests__/BoardHead.test.tsx src/renderer/src/components/__tests__/App.logcat.test.tsx src/renderer/src/components/__tests__/SettingsWindow.test.tsx
npm run typecheck
npm run lint
npm run build
```

关键断言：

- Windows 两窗传入 `hidden` 和 40px 覆盖层；macOS 仍为 `hiddenInset` 与原三灯位置；Linux 不启用覆盖层。
- 设置窗 Windows 允许最小化/最大化；macOS 保留禁用最小化和全屏的断言，不直接删除旧断言。
- 三套主题 × 浅/深色颜色派生正确；模式/主题色切换同步已登记两窗；system 模式随系统外观刷新；未登记窗口不调用 `setTitleBarOverlay`。
- Windows BoardHead 只出现一份图标与应用名，外观/设置/计数行为不变；macOS/Linux 没有新增标识。
- Windows 有日志目标时只有一个开关且位于顶部；无目标时不出现；开关调用仍生效，弹出、贴回、切换目标和 dock 宽度约束保持原规则。
- 设置窗按三种语言显示现有设置标题，Windows 顶部存在，macOS 原拖拽区保留，Linux 无新增顶部。
- 新增主题导出和 App 平台读取后，补全直接消费处的测试 mock；不为让测试通过而改变既有业务预期。

### Windows 真实窗口验收

用隔离用户数据启动本项目实际 Electron，避免诊断操作关闭用户正在运行的设备。

| 场景 | 验收点 |
| --- | --- |
| 主窗默认尺寸 900×670；左栏 220/320/420px | 无独立系统标题栏；透明图标和标题在左上；标题可省略，操作按钮完整 |
| 无设备、有运行设备、外部设备 | Logcat 开关按原条件显隐，按钮区始终可用 |
| dock 收起/展开/弹出/贴回 | Logcat 开关始终在整个主窗右上控制区左边，不随画布右缘漂移 |
| 录屏状态出现 | 录屏信息、Logcat 和系统按钮互不遮挡 |
| 设置窗 760×560、640×460、最大化 | 标题与三个按钮齐全；导航无重复留白；详情仍可滚动 |
| 两窗拖动、双击顶部、边缘缩放、最小化/恢复、最大化/还原、关闭 | 系统操作有效；HTML 控件点击不触发拖动；关闭沿原退出确认和清理流程 |
| Windows 11 最大化按钮悬停 | 检查系统贴靠菜单，记录本机系统支持情况 |
| 100% / 125% / 150% 显示缩放，窗口最大化/还原 | 安全区随系统变化；Logcat 不进入原生按钮命中范围 |
| 琥珀/雾蓝/苔绿，浅色/深色/跟随系统，聚焦/失焦 | 覆盖层无旧底色残留，符号可辨，图标无底板 |
| 简中/繁中/英文 | 标题与现有字典一致，长标题不换行、不挤压控制区 |

留存主窗与设置窗的浅/深色截图，以及 dock 展开和最小尺寸截图。原生按钮命中、贴靠和失焦状态必须检查真实窗口，不能只凭页面截图判定。

macOS：自动测试验证平台分支和原有交互；真机可用时补主窗、设置窗截图和三灯/拖动回归。若当次只有 Windows 环境，报告须明确 macOS 未做真机复验。

## Done criteria

- [x] 用户三项要求均有实际窗口证据，主窗只有一个 Logcat 开关，位置不受 dock 影响。
- [x] macOS/Linux 分支保持原布局与窗口能力，其他子窗没有启用覆盖层。
- [x] 定向测试、typecheck、lint、build 通过；原生按钮、拖拽、缩放和主题已在 Windows 验证，环境限制明确记录。
- [x] 阶段 5 评审结果和未修问题已记录；阶段 6 的功能报告、设计说明和必要 learn/issue 已回写。
- [x] 本计划状态改为 `completed`，`npm run book:index`、`npm run book:release-check` 通过。

当前状态：实现、定向测试、真实 Electron 几何验证、独立评审和 book 回写已完成。定向六文件 107 项通过；三档缩放含窄窗修复各 23 项通过。真实鼠标命中/拖拽/贴靠菜单与 Mac 真机未验证，限制及扩展回归的一项既有路径测试失败见功能报告。


## 执行结果（2026-11-02）

首轮独立评审记录的 P2 窄窗问题未在评审中修复，转入 [独立轮次](2026-11-02-windows-titlebar-narrow-window.md) 后完成。窗口安全区不足时允许顶部左区收缩，Logcat 保留 40px；不改设备列表和 dock 宽度规则。相关日志测试的异步解锁断言改为等待原预期。

详见 [功能报告](../notes/summary/2026-11/2026-11-02-windows-titlebar-adaptation.md)。尚未合并或推送。
