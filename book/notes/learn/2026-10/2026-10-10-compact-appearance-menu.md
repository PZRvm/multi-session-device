---
description: styled 后代 button 仍会影响子组件，外观模式图标须读所选值，窄栏菜单须用真实排版验收
tags: [styled-components, theme, dropdown, 侧栏, 破版, electron]
---

# 板头按钮样式要避开子组件菜单

- **场景**：BoardHead 嵌套 AppearanceModePicker，窄侧栏下菜单文字溢出，跟随系统显示太阳或月亮。
- **原因**：styled 的作用域仍包含所有后代。板头 `button` 的 26px 宽度会传入菜单行，组件拆分本身不能隔离样式。图标按解析后的亮暗取值，还会丢失 system 选项信息。
- **做法**：板头只给 `.settings-button` 定尺寸；外观组件用自己的按钮类名，菜单行铺满内部宽度。入口按 mode 显示 Monitor/Sun/Moon，系统亮暗只决定页面配色。
- **边界**：菜单右端对齐按钮在 220px 侧栏仍可能超出左界；参考图的水平居中展开通过实际排版检查。jsdom 只验证行为；本轮离屏 Electron 使用真实 BoardHead 检查 220/280/320px、三语、三主题、亮暗与三种模式共 162 个紧凑场景，均无文字或图标溢出。

对应 [plan](../../../plans/2026-10-10-compact-appearance-menu.md)。
