---
description: 将 macOS 原生外观同步到应用亮暗选择，修复浅色页面失焦时原生三灯不可见
status: in_progress
created: 2026-10-04
---

# 原生三灯失焦可见性

用户要求原生三灯在应用失焦后仍然可见，截图显示浅色页面左上角为空。

## 需求与分析

运行中的 6174 实例：持久化模式为 `light`，页面 `color-scheme: light`、底色 `rgb(246, 244, 238)`，但 `prefers-color-scheme: dark` 为 true。应用只切页面 tokens，未同步 Electron `nativeTheme.themeSource`，原生控件仍使用系统深色外观。Electron issue [44034](https://github.com/electron/electron/issues/44034) 的维护者说明和跟进将此症状定位到原生外观与背景不一致。

范围为亮暗选择与原生主题同步，保留 hiddenInset、原生按钮、现有位置与板头布局。不改系统外观设置，不恢复自绘，不引入原生扩展或升级 Electron，不改设备业务。

## 设计

- `shared/types.ts` 提供 ThemeMode，store 沿用并重导出，避免跨进程重复类型。
- 增加 `theme:set-mode` 白名单通道与 preload `theme.setMode`；main 校验只接受 system/light/dark，再设置 `nativeTheme.themeSource`。
- ThemeProvider 在 macOS 挂载和模式切换时同步所选模式，包括重启恢复的选择；system 传原值，避免把跟随系统锁成某个亮暗值。向导与主窗沿用同一 Provider、同一持久化选择。现有 matchMedia 监听接收原生外观变化后更新页面。
- 同步调用经 toApiResult 接住拒绝并记录错误；非 macOS 沿用现有页面主题行为。

## 验证与收尾

回归测试覆盖三个合法值、非法入参不改变原生主题、Provider 挂载恢复/切换/非 macOS/失败路径。执行 typecheck、lint、prettier、完整测试；新实例确认页面与原生亮暗一致，并用系统窗口截图验证失焦可见性。按 review 清单检查，回写 stage、learn、本 plan 和索引。

## 结果

主题同步已落地；typecheck、lint、prettier、生产构建通过，9 个测试文件共 63 项通过。重启新实例后，恢复的 light 模式、页面 light 和原生 `prefers-color-scheme` 的 dark=false 一致；修复前同一 light 选择下 dark=true。新增测试覆盖恢复白天、切换黑夜/跟随系统、系统变化、非 macOS 不同步、拒绝路径与非法 payload。八项 review 未发现本轮新增问题。

原生按钮继续由系统管理，未添加焦点时强制显示、渲染层按钮或完整标题栏。窗口截图仍未包含三灯，系统截图入口也未成功，因此失焦按钮像素可见性未独立确认；不能把主题一致或系统可访问性树有按钮当成视觉验收。已请求用户核对新窗口失焦效果；plan 保持 in_progress，待反馈可见后完成，若仍不可见则继续定位。
