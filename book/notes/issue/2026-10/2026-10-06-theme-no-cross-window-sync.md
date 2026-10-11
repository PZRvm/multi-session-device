---
description: 主窗切换主题不广播，已打开的向导窗页面外观不跟随——两窗各自只在 preload 时取一次初值（存量问题）
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：theme:changed 广播通道已存在（i18n 批 1 建立跨窗镜像），已开窗即时跟随。
# 主题变更无跨窗同步

- **Observed**: 2026-10-06 主题持久化 plan Phase 5 review 发现：主窗与向导窗的主题初值都取自各自 preload 的 `theme:get-sync`（一次性），运行中主进程变更主题后无跨窗广播——主窗切亮暗时，已打开的向导窗页面 CSS 不跟随，下次打开向导才正确。存量问题：localStorage 时代同样不同步（zustand persist 未接 storage 事件），本次迁 theme.json 单源后未引入也未恶化，但两窗同源后该缺口更显眼。
- **Reproduction**: 打开「新建设备」向导 → 在主窗切亮暗 → 向导窗配色不变；关掉重开向导即恢复一致。
- **Suggested direction**: 主题 set 处理器里向全部窗口 webContents 推送（如复用 devices:changed 的广播形态）→ 各窗 store 跟随乐观更新。向导是短生命周期模态，接受现状也合理——stage 05 设置窗落地时一并定夺（届时设置窗自身就是第三个消费者）。

严重级：P3（观感问题无数据影响；存量行为，向导重开即正确）。

## 跟进（2026-10-06）——已修

同日提前收口（不必等 stage 05）：main 侧 set 处理器在落盘前经 `theme:changed` 向全部窗口 webContents 广播 `{systemId, mode}`；preload 暴露 `onChanged` 订阅（返回解绑函数，照 devices:changed 形态）；各窗 themeStore 收到广播**直写** setState——不经 setMode/setSystemId，避免回写 IPC 成环；发起窗收到同值直写幂等。系统翻转不需要广播：各窗 matchMedia 各自感知（原有链路）。测试在案：主进程广播断言（set-mode/set-system-id 两腿）+ renderer「收到广播直写不回写 IPC」（两侧 **tests**）；真机 CDP 复验——向导窗打开状态下主窗切暗，向导 1s 内跟随（colorScheme=dark、--board-bg=#101418）。
