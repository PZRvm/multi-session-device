---
description: stage 03 优化轮施工图——新建向导改 Electron 原生模态子窗 + 主窗对齐姊妹仓库板头形态（hidden 标题条/板头三件套/底部橙底新建钮/选中行删除钮常显）
status: completed
created: 2026-10-04
---

# Stage 03 壳优化：原生向导弹窗 + 板头布局 — plan

> 批准记录：2026-10-04 用户两轮下令「1. 新建设备不要 renderer 模态框，要 electron 原生的模态框；2. 总体布局参考 multi-session-browser 截图（顶部无 tab 栏、左上角操作区保留白天黑夜 icon + 设置 icon + 会话数量、新建设备放左下角橙底黑字、列表保留删除按钮）」（bocode-boscope：明确下令实现算批准；原生模态的唯一可行形态是 modal 子 BrowserWindow——主进程 dialog 无法承载三步表单，按此落）。

## Requirements brief（Step 0）

**背景**：stage 03 验收后的体验优化轮。向导搬出主窗 renderer（右栏内嵌卡片 → 原生模态子窗）；主窗 chrome 对齐 `multi-session-browser` 的板头契约（侦察结论：`titleBarStyle: 'hidden'` + `trafficLightPosition {x:14,y:12}`、板头 40px = (40-16)/2 灯高对齐、`-webkit-app-region: drag` + 交互钮 no-drag、三灯占位 60px、计数两位补零加粗、`.new-session` 34px 全宽 accent 底 accent-ink 字——值逐条自姊妹仓库 app.css / main/index.ts 抄录）。

**范围（影响什么）**：

- `electron.vite.config.ts`：renderer 多页入口（index + wizard）
- `src/main/window/`：主窗 darwin hidden chrome；新 `wizard.ts`（modal 子窗 + `wizard:open`/`wizard:close` handler）
- `src/shared/`：wizard 双通道；`src/preload/`：`window.api.wizard`
- `src/renderer/`：`wizard.html` + `src/wizard/` 入口（WizardApp）；新 `BoardHead.tsx`；DeviceListPane 去头尾（板头/底钮上移 App）；DeviceWizard 增 `variant: 'panel' | 'window'`；App 重排；DeviceRow 选中行删除钮常显（CSS）

**排除项（明确不影响）**：

- 设备数据流与持久化零改动（向导窗走既有 `devices:create`，主窗经 `devices:changed` 广播刷新）
- 设置窗不做（icon 禁用占位，title 注明 stage 05）；«收起钮、批量选择 ☑、项目下拉、tab 栏均为图内浏览器专属，未点名不做
- 非 darwin 平台不隐藏标题条（板头照常渲染、无三灯占位）；右栏画布不动

**边界**：向导子窗固定 440×560、不可缩放、模态于主窗、标准标题条「新建设备」；Esc 关闭；重复点新建 = 聚焦既有窗；计数上限 99、两位补零；主题钮三态循环 跟随系统→亮→暗。

**learn/ 检索**：`2026-10-03-cdp-port-stale-instance`（冒烟前清端口）直接适用；`2026-10-01-electron-color-scheme-dark-text`（color-scheme 同链路）适用于向导窗主题。

## Impact range（Phase 1）

| 文件 | 动作 |
| --- | --- |
| electron.vite.config.ts | 加 rollupOptions.input 双页 |
| src/main/window/index.ts | darwin hidden + trafficLightPosition |
| src/main/window/wizard.ts | 新建（modal 子窗 + IPC + 单例聚焦） |
| src/main/ipc/index.ts | 挂 wizard handler |
| src/shared/ipc-channels.ts | +wizardOpen/wizardClose |
| src/preload/api/wizard.ts、api/index.ts | 新建 + 挂载 |
| src/renderer/wizard.html、src/renderer/src/wizard/index.tsx | 新建（入口 + WizardApp） |
| src/renderer/src/components/BoardHead.tsx | 新建（三灯占位/主题/设置/计数，drag 带） |
| DeviceListPane.tsx | 头尾拆除，仅列表 + 空态 |
| DeviceWizard.tsx | variant 支持（window = 填满视口、去卡片框） |
| App.tsx | 板头 + 底钮编排，wizardOpen 状态 → IPC |
| DeviceRow.tsx | 选中行删除钮常显（CSS） |

**风险**：向导窗双加载路径（dev URL / prod file）写错白屏（对齐主窗同款分支）；hidden 标题条后板头按钮未 no-drag 会拖不动窗（按姊妹仓库豁免法）；向导窗未挂主题 Provider 闪白（入口同挂 DeviceThemeProvider，localStorage 同分区自动取主题）。

## Design（Phase 2）

**原生模态**：主窗 renderer 点新建 → `wizard:open`（无 payload）→ main 以 `BrowserWindow.fromWebContents(sender)` 为 parent 建 modal 子窗（单例：已存在则 focus）；子窗加载 wizard.html（独立 React 入口，同 preload、同 DeviceThemeProvider）；WizardApp 直接复用 DeviceWizard（window 变体），创建 = `window.api.devices.create`（走既有守卫+落盘+广播），成败后 `wizard:close` 关自身；Esc = 取消关闭。主窗列表纯靠 `devices:changed` 推送更新，不再持有向导状态。

**板头**：左栏顶部 40px BoardHead——`-webkit-app-region: drag`，darwin 渲染 60px 三灯占位；右端 no-drag 组：主题钮（Monitor/Sun/Moon 随 themeStore.mode，点击循环三态）、设置钮（禁用，title「设置 · stage 05 接入」）、`会话` 标签 + 两位补零加粗计数（tabular-nums，>99 截断显示 99）；hairline 底边。

**底钮**：左栏底部 footer（12px 内边距 + hairline 顶边）全宽 34px Button primary（--accent 底 / --accent-ink 字）+ Plus 图标「新建设备」。

**选中行删除钮**：DeviceRow CSS 增 `[aria-current] 时第 2 颗钮 opacity:1`（hover/focus 路径保留）。

## Build order

1. shared 通道 + preload wizard API——typecheck 绿
2. main：主窗 hidden chrome + wizard.ts 模态子窗 + ipc 挂载——typecheck:node 绿
3. vite 多页 + wizard.html + WizardApp + DeviceWizard window 变体——typecheck 绿
4. BoardHead + DeviceListPane 重构 + App 重排 + DeviceRow CSS——单测绿
5. 全量静态三关 + 测试
6. 冒烟（清端口惯例）：主窗点新建弹原生模态、向导窗内创建、主窗列表推送刷新、板头/底钮/选中行删除钮截屏
7. Phase 5/6：review 只记录 → 回写（stage/03 追加用户下令步骤、plan 翻态、learn、index）→ squash 合回 dev

## Test plan（Phase 4）

- BoardHead：计数补零（0→00、6→06、123→99 截断）；主题钮点击循环三态且 icon 语义随动（Harness 回灌 themeStore）；设置钮 disabled。
- 回归：DeviceWizard 既有 6 条（panel 变体默认路径不变）、DeviceRow 11 条、store/ResizeHandle/SegmentedControl/themeStore 全绿。
- 静态：typecheck / lint / prettier。
- 冒烟：CDP targets 应出现向导窗；跨窗创建回流；截屏存证（板头、底钮、模态窗）。

## Done criteria

主窗点「新建设备」弹**原生模态子窗**且创建后主窗列表即时刷新；mac 首行无标题条、三灯嵌入板头行；板头 = 主题/设置/会话计数三件套；底部橙底黑字全宽新建钮；选中行删除钮常显；测试 + 静态三关全绿；冒烟截屏存证；stage/03 追加步骤记录、plan 翻 completed、索引重刷、合回 dev。

> 完成记录（2026-10-04）：全部落地。40/40 测试绿（新增 BoardHead 5：计数补零/99 截断/主题三态循环/设置禁用/平台分支；回归 35 条不削断言）；typecheck/lint/prettier 全绿。CDP 冒烟：主窗点底钮 → 原生模态子窗（独立 wizard.html target）→ 三步创建 → 子窗自动关闭 → 主窗列表经 changed 回流（计数 01→02）；主题钮循环 亮→暗→跟随系统、color-scheme 同步；控制台零错误；板头/底钮/选中行删除钮截屏存证。途中两处入口相对路径错（./ 应为 ../）当场修正并记 learn。Phase 5 两条发现挂账：创建按钮无防连击（stage 04 前 P2）、向导窗单例 open 竞态（与 ensureLoaded 同族）。BoardHead 与底部按钮按本仓库 Button 基线（32px）而非姊妹仓库 34px——刻意复用设计系统，未抄像素。
