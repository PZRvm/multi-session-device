---
description: 主窗左上亮暗切换钮 review 两项 P3——matchMedia 订阅与 provider 重复、切换钮用动作标签而非 aria-pressed
created: 2026-10-10
tags: [review, p3, theme, a11y, boardhead]
---

# 主窗左上亮暗切换钮 review P3 ×2（已按建议方向修复）

背景：2026-10-10 主窗 BoardHead 左上新增白天/黑夜快速切换（plan 2026-10-10-i18n-and-appearance 收口后的追加小批）。Phase 5 review 按八项检查单过 diff，无 P1/P2；以下两项 P3 记录在案。

**处置记录（同日，用户批准修复）**：P3-1 按建议下沉 `theme/usePrefersDark.ts` 共享订阅，provider 改经 resolved 值响应系统翻转（第二个 matchMedia effect 删除，`resolveMode` 包装随无消费者一并移除）；P3-2 切换钮改 `role="switch"` + `aria-checked`（稳定名「亮暗模式」，title 保留动作提示），测试同步改断言。隐含约定已在 hook 注释显式化。

## P3-1：matchMedia 订阅与 DeviceThemeProvider 重复

问题：`BoardHead.useAppearanceToggle` 对 `(prefers-color-scheme: dark)` 自建了一份监听（让 system 模式下图标随系统翻转），与 `theme/index.tsx` provider 的同名监听各持一份。两份监听同真同假、永不冲突，但同一事实源在 renderer 出现两处订阅，后续若再加消费者会继续复制。

复现：代码路径 `src/renderer/src/components/BoardHead.tsx`（useAppearanceToggle effect）对比 `src/renderer/src/theme/index.tsx`（provider effect）。

建议方向：下沉一个 `usePrefersDark()` hook（theme/ 目录），provider 与 BoardHead 共用；顺带把「store 的 mode 在 system 下不随系统翻转」这个隐含约定显式化（provider 只刷 CSS 变量、不动 store——两处消费方都依赖它，尚无文档）。

## P3-2：切换钮可访问语义是动作标签，非状态钮

问题：切换钮的 aria-label/title 是「切换为白天/黑夜」（动作语义），不是 `aria-pressed` 状态钮。屏幕阅读器听到的是「可执行的动作」，不知道当前处于哪个模式。图标（暗显太阳=点击切亮）沿袭 macOS 系统惯例，视觉上无歧义。

建议方向：若后续做无障碍走查，可改为 `role="switch"` + `aria-checked`（当前亮/暗）或保留动作标签但补 `aria-pressed`；文案键已具备（toggleLight/toggleDark），改造面小。当前不阻塞。

## 其余检查项结论（clean）

- 竞态：快速连点经 store 乐观更新 + 主进程串行落盘，最后写胜出，无需节流；matchMedia effect 随 mode 切换正确重订/清理。
- 边界：jsdom/无 matchMedia 环境有守卫回落亮色（测试覆盖）；system 模式下图标随系统翻转即时（P3-1 的那份订阅负责）；点击落到「与当前解析结果相反」的显式模式，语义正确。
- 权限/通知/事务：零新 IPC，写路径复用 theme:set-mode 既有链路（校验→落盘→nativeTheme→广播），跨窗跟随与重启保留已在真机验证。
- 范围：改动限于 BoardHead + mainWindow 字典两键 ×3 语 + 测试；主进程零改动。
- 复杂度：hook 自包含约 30 行，解析走 shared 单源 resolveThemeMode（未复刻主题持久化 learn 里收口过的重复）。
