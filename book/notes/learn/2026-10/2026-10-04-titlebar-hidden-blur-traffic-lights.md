---
description: macOS titleBarStyle hidden 的失焦三灯整组消失怪癖——setWindowButtonVisibility 在 blur 抢不过系统，hiddenInset 是正解
tags: [electron, macos, titlebar, traffic-lights, gotcha]
---

# titleBarStyle hidden 失焦三灯消失——用 hiddenInset

- **Scenario**: `titleBarStyle: 'hidden'` 去标题条 + `trafficLightPosition` 把三灯嵌进自绘板头；用户报「窗口失焦时左上角按钮整组消失」。
- **Why**: `hidden` 态下 macOS 在窗口失 key 时把三灯整组收掉（不是置灰，是消失）。试图在 `blur` 事件里 `setWindowButtonVisibility(true)` 抢回来**实测无效**——系统收灯发生在事件处理之后。姊妹仓库的 `shell:set-native-window-buttons-visible` 是给「收起态主动藏灯」用的 API 通道，不是这个怪癖的解。
- **How to apply**: 用 `titleBarStyle: 'hiddenInset'` 替代 `hidden`——三灯挂回（透明）标题条图层，失焦只置灰（浅底上近乎白圈）不消失；`trafficLightPosition` 照常生效，布局零改动。验证要用**真实屏幕截图**（`screencapture -x`，CDP 的 `Page.captureScreenshot` 拿不到系统绘制的灯），且聚焦态截图前先确认 `frontmost` 真的切过去了（`System Events` 延时后复核），否则白圈误判成「不显示」。
