---
description: Electron 真机 UI 验收的可观测经验：scrcpy 注入不进内核 getevent 要用 paints 跃迁做正反证；macOS displaysleep 节流会让 ResizeObserver/layout 长时间不就绪；主题切换经 useEffect 生效需轮询；BoardHead 外观控件有分段/下拉两种形态
tags: [electron, cdp, e2e, acceptance, macos, react]
---

# CDP 驱动 Electron 真机验收：可观测信号与三个时序坑

- **Scenario**: 用 CDP（`--remote-debugging-port` + `Input.dispatchMouseEvent`/`Runtime.evaluate`）驱动 Electron 应用做投屏 UI 的自动化验收。
- **Why**: 四个实测结论（2026-10-05，投屏外框验收）：
  1. **scrcpy/`adb shell input` 的注入走 InputManager，不经过 evdev 内核**——`getevent` 计数为 0 不代表注入失败；正反证改用**画面帧数跃迁**：静置后从屏幕顶部下拉通知栏 → `__msdCanvas.paints` 大涨（正证注入通）；从外框拖入屏幕 → paints 平（反证外框吞输入）。
  2. **macOS `displaysleep 2`（分钟）**：屏幕休眠时 Chromium 渲染步进被节流，ResizeObserver 初始回调可拖到"永远"——`status==='ready'` 了但 layout 仍 null、画面 0×0，自动化看似随机挂掉。跑验收全程用 `caffeinate -d` 包住。
  3. **主题切换经 useEffect（paint 后）生效**：click 后同步读 `colorScheme` 必读旧值，要轮询 ~1s；且 BoardHead 外观控件在宽窗是分段 radio、窄窗是下拉 menu（每次点击后菜单**关闭**，逐项点击前要重开菜单重查询）。
  4. 右栏画布挂载条件是 `selected.status === 'running'`：**启动第二台设备不会自动改选中**，要先点行主体选中（注意行内按钮容器 stopPropagation，从按钮 DOM 往上 walk 会停在那里；用坐标点按钮左侧 140px 最稳）。
- **怎么用**: 新写这类脚本时：交互断言前加"layout 就绪"闸门（轮询外框 div 与 canvas 尺寸 >0）；进程清理用 `detached: true` + `process.kill(-pid)`（杀 npx 包装器电不着 electron 子进程，会留僵尸 app 占着 dev 端口和 CDP 端口，下一轮连上的是旧实例——症状是几何数值逐字相同）；每轮起前 `pgrep` 清残留。
