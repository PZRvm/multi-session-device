---
name: 多会话设备
description: 模拟器会话到发信板——左侧会话列表走航显信息板语言（发丝线 + 强调色信号），右侧交给深色工作台画布，双世界各有亮暗变体
theme-systems: 三套设计系统（琥珀/雾蓝/苔绿）的完整 token 单源在 src/shared/themeSystems.ts；本 colors 块仅默认琥珀系统（亮/暗两态）的缺省值快照，与 global.css :root 缺省对账
colors:
  board-bg: '#f6f4ee'
  board-bg-raised: '#ede9df'
  board-hairline: '#d8d2c5'
  board-tile: '#ede9df'
  board-tile-line: '#d8d2c5'
  board-tile-ink: '#9a5f00'
  board-ink: '#1e2329'
  board-ink-dim: '#616974'
  board-bg-dark: '#101418'
  board-bg-raised-dark: '#1a2026'
  board-hairline-dark: '#232830'
  board-tile-dark: '#1a2026'
  board-tile-line-dark: '#2a313a'
  board-tile-ink-dark: '#ffb000'
  board-ink-dark: '#f5f0e8'
  board-ink-dim-dark: '#9aa3ad'
  accent: '#ffb000'
  accent-strong: '#ffc133'
  accent-press: '#e6a000'
  accent-ink: '#221a00'
  idle: '#6b7280'
  loading: '#ffb000'
  danger: '#b3261e'
  danger-dark: '#ffb4ab'
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '15px'
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.5
  body-secondary:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
    fontSize: '11px'
    fontWeight: 400
    letterSpacing: '0.08em'
    lineHeight: 1.5
  mono-data:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace"
rounded:
  segment-inner: '2px'
  xs: '3px'
  sm: '4px'
  md: '6px'
  pill: '14px'
spacing:
  xs: '4px'
  sm: '6px'
  md: '8px'
  lg: '12px'
  xl: '14px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
    rounded: '{rounded.md}'
    height: '32px'
  button-primary-hover:
    backgroundColor: '{colors.accent-strong}'
  button-primary-active:
    backgroundColor: '{colors.accent-press}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.board-ink}'
    rounded: '{rounded.md}'
    height: '32px'
  input-text:
    backgroundColor: '{colors.board-bg-raised}'
    textColor: '{colors.board-ink}'
    rounded: '{rounded.sm}'
    height: '28px'
  list-row:
    backgroundColor: '{colors.board-bg}'
    textColor: '{colors.board-ink}'
    padding: '10px 12px'
  list-row-selected:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
  settings-nav-row:
    backgroundColor: 'transparent'
    textColor: '{colors.board-ink}'
    rounded: '{rounded.md}'
    padding: '8px 10px'
  settings-nav-row-selected:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.accent-ink}'
  settings-appearance-option:
    backgroundColor: 'transparent'
    textColor: '{colors.board-ink-dim}'
    rounded: '{rounded.segment-inner}'
    padding: '2px'
    width: '27px'
    height: '26px'
  settings-theme-swatch:
    textColor: '{colors.accent-ink}'
    rounded: '{rounded.sm}'
    padding: '0'
    width: '28px'
    height: '28px'
  settings-select:
    backgroundColor: '{colors.board-bg-raised}'
    textColor: '{colors.board-ink}'
    rounded: '{rounded.sm}'
    height: '28px'
    width: '180px'
  settings-button-danger:
    backgroundColor: 'transparent'
    textColor: '{colors.danger}'
    rounded: '{rounded.sm}'
    padding: '4px 12px'
    height: '32px'
  settings-keycap:
    backgroundColor: '{colors.board-tile}'
    textColor: '{colors.board-ink}'
    typography: '{typography.mono-data}'
    rounded: '{rounded.xs}'
    padding: '1px 5px'
---

# Design System: 多会话设备

> 本记录由 impeccable `document` 自姊妹仓库 `~/foreunit/multi-session-browser`（阶段 1 建成、DESIGN.md 411 行的成熟系统）反推平移，供本仓库 AI agent 生成新界面时 stay on brand。Ground truth 是 `src/shared/themeSystems.ts`（token 单源）与 `src/renderer/src/styles/global.css`（:root 缺省对账基准），不是任何计划文档。

## Overview

**Creative North Star: "到发信板（The Departure Board）"**

这个世界同样由两个半区构成，各有各的法律。左侧是航显信息板：暖灰或近黑蓝底上的行式栅格，1px 发丝线分隔、无阴影，强调色只作为「航班信息」出现——当前选中的会话、运行中的信号、唯一的大面积主按钮（默认系统为航显琥珀 #ffb000；强调色系统可在琥珀/雾蓝/苔绿三套间整套切换，token 单源 `src/shared/themeSystems.ts`，与亮暗正交组合）。右侧是工作台画布：深色工作台底上承载模拟器画面（stage 04 起投屏落入），它是「列车本身」——画布区不引入信息板以外的装饰语言，强调色同样不进画布。两个半区各有完整 light/dark 变体，切换只改变表面与墨色，不改变布局与层级。

密度是桌面效率工具的密度：13px 基准字号、双行会话行、一切状态静置可读。深度不靠阴影——全应用 0 box-shadow——靠发丝线与色阶（board-bg / board-bg-raised / board-tile 三层）。状态过渡压在 0.12s，无签名动画。

方向上明确拒绝的：类目默认的深色竖栏 + 蓝色高亮 + 圆角卡片列表。选中不用蓝、不用描边，用整行强调色反白，如机场信息屏上的高亮航班。

**Key Characteristics:**

- 两个世界：左侧发信板（自著语言，管会话）/ 右侧工作台画布（stage 04 起承载模拟器画面），本阶段以元素基线奠定板面语言
- 行式栅格 + 1px 发丝线，无阴影、无卡片
- 强调色 = 航班信息：选中反白、加载信号、主按钮、焦点环，屏幕占比极小；三套主题色整套切换，配置单源 themeSystems.ts
- 数字即信号：计数与序号一律 mono 裸数字（tabular-nums），不引入卡片砖形（与源仓库差异：本仓库无计数砖组件，mono 数字直接排版）
- 桌面工具密度：13px 基准，状态静置可读，操作悬停显现
- 亮暗三态（跟随系统/亮/暗）：运行时经注入链全量切换 CSS 变量与 `color-scheme`，与 token 单源同链路（防深字深底静默复发——2026-10-01 learn）

## Colors

一句话：三套信息板色彩系统（琥珀/雾蓝/苔绿，各含亮暗两态）承载全部界面；画布工作台底与信息板同族（board-bg），不引入第二色域。**下文色值叙述均为默认琥珀系统的定稿值**；雾蓝/苔绿的同名 token 值见配置单源 `src/shared/themeSystems.ts`（新增主题 = 该文件加一条配置）。

### Primary

- **强调色基（Accent）**（默认琥珀 #ffb000 / `--accent`）：唯一的大面积信号色。允许出现的位置：选中行整行反白底、主按钮、运行中信号、`:focus-visible` 焦点环。它的稀缺就是它的信息量。
- **强调色悬停（Accent Strong）**（默认 #ffc133 / `--accent-strong`）：主按钮 hover。
- **强调色按压（Accent Press）**（默认 #e6a000 / `--accent-press`）：主按钮 active。
- **强调色上的墨（Accent Ink）**（默认 #221a00 / `--accent-ink`）：反白行与主按钮上的近黑字，是强调色世界里唯一的文字色。

### Secondary

- **空闲灰（Idle）**（#6b7280 / `--idle`）：空闲状态点。状态系统只有两信号：灰 = 空闲，强调色 = 运行中（`--loading` 亮态取信号深色、暗态取信号基色，随主题系统切换，与 `--accent` 同源异名）。
- **危险墨（Danger）**（`--danger`，亮暗值见 frontmatter）：三套主题共用的危险文案与描边色，已在设置窗危险分类、危险标题、删除按钮描边和关窗错误提示启用。它不承担运行状态信号，不铺红色面板；单源为 `themeSystems.ts`，亮态缺省同步到 `global.css`。

### Neutral

信息板与工作台共用的底色族：

- **亮色板底 / 抬升层 / 发丝线**（#f6f4ee / #ede9df / #d8d2c5）：暖灰信息板的底、行 hover 与唯一分隔手段；主墨 #1e2329，次墨 #616974。**控件描边**（#bcb4a6 / `--board-control-line`）：输入与分段控件边界，与滚动条 hover 同值异义 token。
- **暗色板底 / 抬升层 / 发丝线**（#101418 / #1a2026 / #232830）：近黑蓝工作台；主墨 #f5f0e8，次墨 #9aa3ad；控件描边 #3a434e。
- **砖面（Board Tile）**（亮 #ede9df / 暗 #1a2026，`--board-tile`）：键帽与小面积承载面的预留 token，两态都与各自抬升层同值、不同语义。
- **砖上墨（Board Tile Ink）**（亮 #9a5f00 / 暗 #ffb000，`--board-tile-ink`）：白天降饱和信号深色、黑夜信号基色，昼夜翻转——分段控件选中瓣字形等小信号用。

半透明蒙版（veil）按主题为语义 token：hover 蒙版 `--board-hover-veil`（亮 ink @ 0.08 / 暗 white @ 0.08）、强调蒙版 `--accent-veil`（accentInk @ 0.12）。

### Named Rules

**The Accent Stays On The Board Rule（强调色不出板）.** 强调色只出现在信息板半区与全局焦点环上；右侧画布区只用中性板面色阶。强调色在大面积上只允许两种形态：选中行的整行反白、主按钮——此外永远是点、字、数字级的小信号。

**The Inversion Rule（反白即选中）.** 选中态不是描边、不是下划线、不是左侧色条，是整行强调色反白（`--accent` 底 + `--accent-ink` 字），行内次级文字降不透明度 0.72，状态点同步变墨色。如机场信息屏的高亮航班。

## Typography

**Body Font:** 系统栈（`-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif`）
**数字字体:** mono 栈（`'SF Mono', ui-monospace, Menlo, Consolas, monospace` + `tabular-nums`）——计数、下标、端口号类数字专用

**Character:** 全部走系统栈——桌面工具不引入外部字体，中文靠 PingFang SC / Microsoft YaHei。数字用 mono + 表格数字，对位不跳。整个字阶压在 11–15px 之间，是扫读型工具的坡度。

### Hierarchy

- **Title**（600，15px，1.5）：界面中最大的一级，空态标题与窗内主标题。
- **Body / 板面主文**（400–600，13px，1.5）：基准级。会话名（600）、主按钮、正文都在这一级。
- **Body Secondary**（400，12px，1.5）：次级信息——说明文字、副行、提示。
- **Label**（400，11px，letter-spacing 0.08em）：状态字（空闲/运行中）、计数标签。

### Named Rules

**The Monospace Numbers Rule（数字用 mono）.** 任何计数、下标、端口、设备序号类数字一律 mono 栈 + tabular-nums 排版，不用比例字体裸排。

## Layout

主窗口：900×670（现自检壳窗口尺寸，stage 03 分栏落地时随布局复核）。主窗口无响应式断点——这是桌面应用，弹性来自窗口与分栏尺寸。

骨架（stage 03 起为左右分栏，flex 行）：左栏为会话信息板，`flex: none`；1px 发丝线分隔（发丝线即分隔条视觉）；右侧工作台画布 `flex: 1`，`min-width: 0`，底色随主题 board-bg，模拟器画面居中嵌入。

间距节奏：4–14px 的紧凑值域（gap 4/6/8，padding 6/10/12/14）。没有大留白——信息板不喘气，只扫读。

### 设置窗

独立桌面窗初始（760×560 DIP）、最小（640×460 DIP）。macOS 无顶部标题行（hiddenInset），原生三灯落在左上（trafficLightPosition 14×12）；顶边覆盖（32px）拖拽区承担窗口拖动，其他平台保留系统标题栏、不渲染拖拽区。正文与导航填满窗体；导航固定宽（176px），内边距（32px 8px 10px）、分类间距（2px），危险区用剩余空间沉底。右侧详情单独纵向滚动，导航保持位置；详情内边距（38px 28px 28px）。

窗口宽度不大于（700px）时，设置行的控件落到标签下方，目录文字与动作也改为纵向排列；导航宽度和分类顺序保持。长说明与路径允许折行，快捷键表格保持操作、键位、生效位置三列，键帽可换行。

## Elevation & Depth

**无阴影。全应用 0 box-shadow。** 深度由三件事表达：1px 发丝线分隔（`--board-hairline`）、色阶抬升（board-bg → board-bg-raised → board-tile，三层即全部层次）、强调色反白（选中是「点亮」不是「抬起」）。

### Named Rules

**The Hairline Rule（发丝线，不用阴影）.** 任何新面板、新分层的分隔一律 1px 发丝线或色阶抬升；引入 box-shadow 即破坏世界。悬停反馈是背景色过渡（0.12s），不是浮起。

## Shapes

方形行、圆点、小圆角控件。三种母题：

- **列表行是直角的**：无圆角、无卡片化，靠发丝线分行。这是信息板的行式本质。
- **圆（50%）属于信号**：状态点等圆形信号元素。
- **控件小圆角**：按钮与输入 6px/4px；分段控件 4px。不做胶囊与大圆角卡片。

设置窗延续紧凑控件：按钮、输入、主题色方块和分段外轨圆角（4px）；外轨内缩（2px），内瓣圆角（2px，`segment-inner`）；键帽圆角（3px）。设置分类导航内缩并采用（6px）圆角，这是导航控件的局部几何，会话列表行仍保持直角。

### 设备外框（2026-10-05 投屏工作台引入）——唯一的"大圆角"豁免区

投屏工作台（右侧 Stage）承载模拟 Android 设备外框，是全应用唯一允许大外圆角的元素（手机 20px / 平板 16px / 未知 10px）：它模拟实体手机/平板的壳，属于"列车本身"而非信息板控件——普通控件不得效仿此圆角。外壳只包在屏幕之外（手机边距 T18/B12/L12/R12，侧边与圆角匹配避免四角收窄发撇；平板四边 12；未知四边 8），屏幕自身无圆角无开孔（不裁切视频像素），上边框内的听筒/摄像头装饰 `aria-hidden` 且不接输入。颜色三 token 入配置单源：`--device-shell`（壳面，亮 ≡ hairline / 暗 ≡ tileLine）、`--device-shell-edge`（外缘线 ≡ controlLine）、`--device-bezel-ink`（装饰 ≡ inkDim）。工作台底即 `--board-bg`，不引入第二色域；强调色仍不进画布。

## Components

### 按钮（Button）— 元素基线

- **Primary：** 强调色底（`--accent`）+ accent-ink 字，32px 高、6px 圆角、13px/600；hover `--accent-strong`、active `--accent-press`（0.12s 背景过渡）。屏幕上唯一的大面积强调色。
- **Ghost：** 透明底 + board-ink 字 + 1px `--board-control-line` 描边，同度量；hover 底转 `--board-hover-veil`、描边加深。中性操作一律 ghost，不开第二实底色。
- **Focus：** `:focus-visible` 2px `--accent` 外框、offset 2px。

### 输入（Input）— 元素基线

抬升层底（`--board-bg-raised`）+ 1px `--board-control-line` 描边、4px 圆角、28px 高、12px 字；focus 描边升墨级（`--board-ink-dim` → `--board-ink`），底色同步升纯抬升；placeholder 次墨。danger token 已进入配置单源并在设置窗危险文案与描边中启用；输入错误态尚未使用它。

### 列表行（List Row）— 元素基线，世界的原子

两行栅格：主行 13px/600 + 副行 12px 次墨，`padding: 10px 12px`，行间 1px 发丝线。直角、无卡片。Default：board-bg 底 + board-ink 字；hover 抬升 board-bg-raised（0.12s）；**Selected：整行强调色反白**（Inversion Rule），副行与状态点降不透明度 0.72。整行可点选、可键盘聚焦（tabIndex 0，Enter/Space 选中，`aria-current`）。

### 分隔（Divider）— 元素基线

1px `--board-hairline` 实线，水平或垂直；分组分隔不用间距不用阴影，只用发丝线。列表行间的发丝线由列表容器统一绘制（`border-top`），独立 Divider 用于区块之间。

### 分段控件（Segmented Control）— 元素基线

三态并置的外观选择（跟随系统/亮/暗），分别用（16px）显示器、太阳、月亮 SVG 图标呈现。轨道 = board-bg-raised + 控件线描边、选中瓣 = `--board-segment-selected-bg` + `--board-tile-ink`（昼夜翻转的信号深色），未选 = 次墨；外轨圆角（4px）、内缩与间距（2px），内瓣宽（27px）、最小高（26px）、圆角（2px）。当前仅在设置窗静态展示，原生 disabled；按钮有三语 `aria-label` / `title` 和 `aria-pressed`，不提供切换行为。主窗板头保留设置齿轮与设备计数，不再显示外观 tab 或窄窗菜单。

### 设置窗（Settings Window）— 静态呈现

五个详情分类共用 `SettingsParts`；窗壳与共用详情各以单个 styled `Wrapper` 管理后代样式，状态与窄窗规则留在各自边界内。

- **窗口控件：** macOS 使用原生三灯（hiddenInset，trafficLightPosition 14×12，与主窗/向导窗同度量），renderer 不自绘任何窗口控件；最小化与全屏能力禁用，黄/绿为无效按钮、红灯关闭窗口。顶部（32px）拖拽带仅 darwin 渲染；其他平台沿用系统标题栏。
- **导航：** 通用、模拟器、快捷键、关于、危险区五类；抬升层底、1px 右侧发丝线，行高至少（36px），内边距（8px 10px）、圆角（6px）。选中使用整行 `--accent` 底 + `--accent-ink` 字和（600）字重，包括选中的危险分类；未选中的危险分类使用 `--danger`。Lucide 图标与文字并列，通用使用齿轮，图标（15px）并标为装饰。
- **文字与行：** 详情标题（15px/600），正文（13px），引导、描述、分组标题和路径（12px）；设置行以发丝线分隔，最小行高（66px）、上下内边距（12px）。路径、数值和键帽沿用 `ui-monospace, 'SF Mono', Menlo, monospace`；这是现有系统 mono 栈的组件写法，不新增字体。键帽是标准按键文字，不能用作替代图标。
- **控件：** 下拉宽（180px）、输入高（28px）、普通按钮最小高（32px）；背景取板面或抬升层，描边取控件线。外观分段只呈现当前三态；主题色为既有三系统 swatch 的（28×28px）方块、间距（10px），选中以（2px）主墨外框（offset 2px）和（15px）居中勾标识，勾取 `--accent-ink`。不显示重复色名，按钮保留三语 `aria-label` / `title` 和 `aria-pressed`。键帽取砖面、砖线与主墨。危险按钮透明底 + `--danger` 文字和描边。
- **焦点与滚动：** 分类按钮和可滚动详情用（2px）焦点框；通常为 `--accent` 内框（offset -2px），选中导航为 `--accent-ink` 内框（offset -4px），避免与反白底混淆。详情可由 Tab 进入并用 End 到达末尾；滚动条取既有主题 token，无阴影。
- **只读状态：** 当前只开放开窗（主窗齿轮）与分类切换；关窗、最小化与全屏由系统窗口控件承担，不经 renderer 桥。业务按钮、下拉、输入、单选、分段和主题色样均用原生 disabled；输入与下拉保留主墨及（1）不透明度，不靠整体淡化制造禁用态。设置六个主题态核对中，次级文字最低（4.57:1）、危险文字最低（5.26:1）。
- **真实占位：** 当前实窗默认 `zh-CN`，外观只读现有主题镜像；`zh-CN` / `zh-TW` / `en-US` 是设置组件的同键文案字典，不代表全应用 i18n 或语言切换已完成。未知版本、运行环境、目录和内存阈值保持明确占位；SDK 样例目录标为示例，偏好保存、SDK 检测/切换和删除尚未接入。
- **关于：** 复用 `resources/icon.png` 既有应用图标，显示尺寸（64×64px），没有新增图像资产。此段记录已实现的静态呈现，不代表完整设置功能或发布验收完成。

### 窗口策略（2026-10-12 起）

**渲染层不使用模态框**——需要 secondary 视图时用独立子窗口（对账详情窗为首个用例：`report.html` 入口、main 建窗单例、已开聚焦、主窗关闭带走、就绪后崩溃释放单例）。原生 MessageBox 仅用于短摘要与确认（40 行截断防线兜底）；长内容一律进子窗口滚动区。危险区确认词输入沿用主进程 dialog（PRD 既定），不引入渲染层弹层。

## Do's and Don'ts

### Do:

- **Do** 新面板延续行式栅格 + 1px 发丝线分层，会话列表行保持直角；设置分类导航沿用内缩的小圆角控件。
- **Do** 业务颜色经 CSS 变量引用 token（`var(--board-*)` / `var(--accent-*)`）；新增业务色值先进 `themeSystems.ts` 配置单源再消费。
- **Do** 选中态整行强调色反白（`--accent` 底 / `--accent-ink` 字），次级信息降不透明度 0.72。
- **Do** 焦点统一 `:focus-visible` 2px `--accent` 外框、offset 2px。
- **Do** 亮暗切换经主题注入链同步替换 CSS 变量与 `color-scheme`，保持布局与 0.12s 过渡不变。
- **Do** 计数、下标、端口类数字用 mono 栈 + tabular-nums。

### Don't:

- **Don't** 引入任何 box-shadow——深度只有发丝线、色阶、反白三种。
- **Don't** 在业务组件里写硬编码色值（hex/rgb 字面量）——业务颜色只从 token 单源派生（2026-10-01 深字深底静默事故的根治约定）。
- **Don't** 回到类目默认：深色竖栏 + 蓝色高亮 + 圆角卡片列表是方向契约明确拒绝的形态。
- **Don't** 让强调色进画布区或作大面积装饰底色；强调色是信号。
- **Don't** 把会话列表行卡片化、圆角化或加左缘色条；选中只有反白一种语言。
- **Don't** 启用配置单源之外的色值 token（对齐源仓库 `--accent-ink-dim` 教训：先入配置再引用）。
