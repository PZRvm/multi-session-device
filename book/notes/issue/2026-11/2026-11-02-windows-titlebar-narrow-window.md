---
description: Windows 顶部宽左栏配合窄主窗时 Logcat 越界，已在独立修复轮次处理，三档缩放复验通过
status: resolved
---

# P2：主窗缩窄后 Logcat 越过原生按钮安全区

- 观察：首轮独立评审定位到 App 顶部的 BoardHead 禁止收缩。原生按钮安全区变窄时，左栏仍占完整 listWidth，Logcat 被挤到安全区之外。
- 复现：Windows 主窗将左栏拉到 420px，收起日志 dock，再将内容窗宽缩到 500px。Electron 39.8.10 实测安全区右缘 x=364，Logcat 的 x=420、right=450，进入原生按钮区域。
- 证据：本地 `dist/windows-titlebar-check/narrow-review/results.json`，断言 `Logcat overlaps controls` 失败；同目录保存原生窗口截图。
- 建议方向：保留原生安全区和现有窗口宽度规则，让顶部左侧标识区域可以收缩，右侧 Logcat 独占最少 40px；补宽左栏与收起 dock 的窄窗组合验证。
- 处理：阶段 5 仅记录，未在评审中修改源码。转入[独立修复计划](../../../plans/2026-11-02-windows-titlebar-narrow-window.md)，仍属于用户已批准的顶部不遮挡范围。

## 独立修复结果

顶部左区允许收缩，右区至少保留 40px，未改实际设备列表宽度和窗口最小宽度。100% 时同一复现的 Logcat right 从 450 改为 354，安全区 right=364；125%/150% 时分别为 355 与 365，均留 10px 间距。三档各 23 项真实 Electron 检查通过，独立复审未发现新的确定性回归。更极端窄窗配合英文和宽左栏的内部控件布局仍是待核验建议，未记录为已确认缺陷。
