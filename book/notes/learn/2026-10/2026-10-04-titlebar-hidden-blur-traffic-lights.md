---
description: macOS titleBarStyle hidden 的失焦三灯整组消失怪癖——setWindowButtonVisibility 在 blur 抢不过系统，hiddenInset 是正解
tags: [electron, macos, titlebar, traffic-lights, gotcha]
---

# titleBarStyle hidden 失焦三灯消失——用 hiddenInset

- **Scenario**: `titleBarStyle: 'hidden'` 去标题条 + `trafficLightPosition` 把三灯嵌进自绘板头；用户报「窗口失焦时左上角按钮整组消失」。
- **Why**: `hidden` 态下 macOS 在窗口失 key 时把三灯整组收掉（不是置灰，是消失）。试图在 `blur` 事件里 `setWindowButtonVisibility(true)` 抢回来**实测无效**——系统收灯发生在事件处理之后。姊妹仓库的 `shell:set-native-window-buttons-visible` 是给「收起态主动藏灯」用的 API 通道，不是这个怪癖的解。
- **How to apply**: 用 `titleBarStyle: 'hiddenInset'` 替代 `hidden`——三灯挂回（透明）标题条图层，失焦只置灰（浅底上近乎白圈）不消失；`trafficLightPosition` 照常生效，布局零改动。验证要用**真实屏幕截图**（`screencapture -x`，CDP 的 `Page.captureScreenshot` 拿不到系统绘制的灯），且聚焦态截图前先确认 `frontmost` 真的切过去了（`System Events` 延时后复核），否则白圈误判成「不显示」。

## 跟进（2026-10-04 二轮）——hiddenInset 也不够，终解是自绘

hiddenInset 的置灰灯在浅色板面上对比度太低，用户复测仍报「看不到」。终解：放弃原生灯——建窗后 darwin 门控 `setWindowButtonVisibility(false)` 永久隐藏，renderer 板头自绘三颗圆点（聚焦 mac 三色 #ff5f57/#febc2e/#28c840、失焦 control-line 灰），focus/blur 由主进程推送（`window:focus-changed`），最小化/全屏走 `window:minimize` / `window:toggle-fullscreen` IPC，关闭 = renderer `window.close()`（姊妹仓库 a49bcae 先例）。自绘即页面内容，任何焦点状态、任何截图通道都可见——这才是可验收的形态。

## 终裁（2026-10-04 三轮）——回退自绘，定稿 hiddenInset

用户拍板：要**原生三灯**，失焦灰态可接受。自绘方案（1c86331）整体回退，终态 = `titleBarStyle: 'hiddenInset'` + `trafficLightPosition {x:14, y:12}`，板头只留 60px 占位（TrafficSpacer）。两条复盘：① hiddenInset 的失焦置灰本来就是正确答案（本轮与 a8e3867 两轮真屏验证均可见），用户当时复测仍报「看不到」的最大嫌疑是**其 6174 实例跑着改动前的旧构建**——验证 UI 修复前先确认对方看的是新构建；② 「按钮看不见」类报障先问清要原生还是自绘（用户诉求可能是形态偏好而非单纯可见性），方案分叉极大。
