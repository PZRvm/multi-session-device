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
rounded:
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

桌面窗口：900×670（现自检壳窗口尺寸，stage 03 分栏落地时随布局复核）。无响应式断点——这是桌面应用，弹性来自窗口与分栏尺寸。

骨架（stage 03 起为左右分栏，flex 行）：左栏为会话信息板，`flex: none`；1px 发丝线分隔（发丝线即分隔条视觉）；右侧工作台画布 `flex: 1`，`min-width: 0`，底色随主题 board-bg，模拟器画面居中嵌入。

间距节奏：4–14px 的紧凑值域（gap 4/6/8，padding 6/10/12/14）。没有大留白——信息板不喘气，只扫读。

## Elevation & Depth

**无阴影。全应用 0 box-shadow。** 深度由三件事表达：1px 发丝线分隔（`--board-hairline`）、色阶抬升（board-bg → board-bg-raised → board-tile，三层即全部层次）、强调色反白（选中是「点亮」不是「抬起」）。

### Named Rules

**The Hairline Rule（发丝线，不用阴影）.** 任何新面板、新分层的分隔一律 1px 发丝线或色阶抬升；引入 box-shadow 即破坏世界。悬停反馈是背景色过渡（0.12s），不是浮起。

## Shapes

方形行、圆点、小圆角控件。三种母题：

- **列表行是直角的**：无圆角、无卡片化，靠发丝线分行。这是信息板的行式本质。
- **圆（50%）属于信号**：状态点等圆形信号元素。
- **控件小圆角**：按钮与输入 6px/4px；分段控件 4px。不做胶囊与大圆角卡片。

## Components

### 按钮（Button）— 元素基线

- **Primary：** 强调色底（`--accent`）+ accent-ink 字，32px 高、6px 圆角、13px/600；hover `--accent-strong`、active `--accent-press`（0.12s 背景过渡）。屏幕上唯一的大面积强调色。
- **Ghost：** 透明底 + board-ink 字 + 1px `--board-control-line` 描边，同度量；hover 底转 `--board-hover-veil`、描边加深。中性操作一律 ghost，不开第二实底色。
- **Focus：** `:focus-visible` 2px `--accent` 外框、offset 2px。

### 输入（Input）— 元素基线

抬升层底（`--board-bg-raised`）+ 1px `--board-control-line` 描边、4px 圆角、28px 高、12px 字；focus 描边升墨级（`--board-ink-dim` → `--board-ink`），底色同步升纯抬升；placeholder 次墨。错误态预留 danger token（本阶段未启用，启用前先入配置——对齐源仓库 `--accent-ink-dim` 教训）。

### 列表行（List Row）— 元素基线，世界的原子

两行栅格：主行 13px/600 + 副行 12px 次墨，`padding: 10px 12px`，行间 1px 发丝线。直角、无卡片。Default：board-bg 底 + board-ink 字；hover 抬升 board-bg-raised（0.12s）；**Selected：整行强调色反白**（Inversion Rule），副行与状态点降不透明度 0.72。整行可点选、可键盘聚焦（tabIndex 0，Enter/Space 选中，`aria-current`）。

### 分隔（Divider）— 元素基线

1px `--board-hairline` 实线，水平或垂直；分组分隔不用间距不用阴影，只用发丝线。列表行间的发丝线由列表容器统一绘制（`border-top`），独立 Divider 用于区块之间。

### 分段控件（Segmented Control）— 元素基线

三态并置的一步直达切换（本阶段承载亮暗模式：跟随系统/亮/暗）。轨道 = board-bg-raised、选中瓣 = `--board-segment-selected-bg`（亮 #ffffff 纯白抬升瓣 / 暗 #2a313a 抬升一档）+ 瓣上字形 `--board-tile-ink`（昼夜翻转的信号深色），未选 = 次墨，hover = board-hover-veil，4px 圆角。radiogroup 语义 + 方向键循环。

## Do's and Don'ts

### Do:

- **Do** 新面板延续行式栅格 + 1px 发丝线分层，行保持直角。
- **Do** 一切颜色经 CSS 变量引用 token（`var(--board-*)` / `var(--accent-*)`）；新增色值先进 `themeSystems.ts` 配置单源再消费。
- **Do** 选中态整行强调色反白（`--accent` 底 / `--accent-ink` 字），次级信息降不透明度 0.72。
- **Do** 焦点统一 `:focus-visible` 2px `--accent` 外框、offset 2px。
- **Do** 亮暗切换经主题注入链同步替换 CSS 变量与 `color-scheme`，保持布局与 0.12s 过渡不变。
- **Do** 计数、下标、端口类数字用 mono 栈 + tabular-nums。

### Don't:

- **Don't** 引入任何 box-shadow——深度只有发丝线、色阶、反白三种。
- **Don't** 组件里写硬编码色值（hex/rgb 字面量）——颜色只从 token 单源派生（2026-10-01 深字深底静默事故的根治约定）。
- **Don't** 回到类目默认：深色竖栏 + 蓝色高亮 + 圆角卡片列表是方向契约明确拒绝的形态。
- **Don't** 让强调色进画布区或作大面积装饰底色；强调色是信号。
- **Don't** 把列表行卡片化、圆角化或加左缘色条；选中只有反白一种语言。
- **Don't** 启用配置单源之外的色值 token（对齐源仓库 `--accent-ink-dim` 教训：先入配置再引用）。
