---
description: 修复轮施工图——自绘三灯根治失焦消失（原生灯永久隐藏 + renderer 常绘圆点 + minimize/fullscreen IPC）、向导弹窗填满视口
status: in_progress
created: 2026-10-04
---

# 壳修复：自绘三灯 + 向导弹窗布局 — plan

> 批准记录：2026-10-04 用户两条报障（「失焦看不到红绿灯」「向导弹窗按钮区下方大片空白」）+ 一问（向导/设备列表与 Android SDK 的关系——只答疑不改码，答案见对话与 PRD：窗口形态保留、stage 04 换真实数据源；设备列表仅应用内新建，不对接官方全量列表）。明确报修即批准。

## Requirements brief（Step 0）

**背景**：hiddenInset 只把失焦三灯从「整组消失」变成「置灰」，但置灰灯在浅色板面上近乎隐形（用户复测仍报不可见）。根治 = 放弃原生灯的聚焦依赖，改自绘（姊妹仓库 a49bcae 先例：自绘关闭点 + window.close()；本仓库扩到三颗）。

**范围**：

- `main/window/index.ts`：`setWindowButtonVisibility(false)`（darwin，建窗后一次性）+ focus/blur 推送 `window:focus-changed`
- `main/window/controls.ts`：`window:minimize` / `window:toggle-fullscreen` handler（sender 解析窗体）
- `shared/ipc-channels.ts` + `preload/api/window.ts`：三通道 + `windowApi`（minimize/toggleFullscreen/onFocusChanged）
- `components/BoardHead.tsx`：三灯占位改为自绘三圆点（关闭/最小化/全屏钮；聚焦=mac 三色、失焦=control-line 灰），订阅 focus 推送
- `components/DeviceWizard.tsx`：window 变体 `height: 100vh`（footer 贴底）

**排除项**：不动设备数据流与向导逻辑；非 darwin 平台不绘三灯（保留系统框）；不做灯上悬停 glyph；全屏钮 = toggle 全屏（不做分屏 zoom 语义）。

**边界**：圆点 12px、间距 8px，位置对齐原 trafficLightPosition（x:14）；关闭 = `window.close()`（renderer 直关，姊妹仓库先例）；聚焦态初值 = true（主窗启动即焦点）。

**learn/ 检索**：`2026-10-04-titlebar-hidden-blur-traffic-lights`（hiddenInset 局限）直接适用——本 plan 是其续章。

## Design（Phase 2）

- 主进程：建窗后 darwin 门控 `setWindowButtonVisibility(false)`；`focus`/`blur` 事件向自己的 webContents 推 `{focused: boolean}`。隐藏原生灯后 `trafficLightPosition` 失去意义，删除该选项。
- renderer：BoardHead darwin 分支渲染三颗 `role="button"` 圆点（aria 关闭/最小化窗口/进入全屏窗口）；`-webkit-app-region: no-drag`；颜色随 `focused` 切换。点击：close = `window.close()`；minimize/fullscreen = `window.api.window.*`。
- 向导：window 变体 Wrapper `height: 100vh`——flex column（Header none / Body flex:1 / Footer none）使 footer 贴窗底。

## Build order

1. shared 通道 + preload windowApi + main（隐藏原生灯 + focus 推送 + controls handler）→ typecheck:node
2. BoardHead 三圆点 + DeviceWizard 100vh → typecheck
3. BoardHead 测试改写（三灯钮存在/点击回调/失焦切换）→ 全绿 + 三关
4. 冒烟：聚焦/失焦真屏截屏（灯恒可见）、向导弹窗 footer 贴底
5. 回写 + 合回 dev

## Test plan

BoardHead：darwin 渲染三颗灯钮且 aria 正确；点击最小化/全屏调到 stub；onFocusChanged 回调 false 后仍渲染（可见性由 CSS 色，jsdom 不断言色）；非 darwin 回归页内标题。DeviceWizard 回归 6 条。冒烟双态截屏。

## Done criteria

失焦下三灯清晰可见（真屏截图对比）；向导弹窗 footer 贴底无空洞；测试全绿三关全绿；回写 + 合回 dev。

> 完成记录（2026-10-04）：两条全部落地。① 自绘三灯：原生灯永久隐藏（setWindowButtonVisibility(false)），BoardHead 常绘三圆点（聚焦 #ff5f57/#febc2e/#28c840、失焦 control-line 灰——CDP 实测两态计算样式 rgb(255,95,87)↔rgb(58,67,78) 双向切换），关闭=window.close()、最小化/全屏走 window:* IPC；② 向导弹窗 window 变体 100vh，footer 底边 = 视口底（实测 532=532），空洞消除。47/47 测试绿（BoardHead +2 三灯条目）。hiddenInset 的 learn 补二轮跟进。
