---
description: 新建设备向导从模态子窗改为可移动的独立窗口——非模态不阻塞主窗、创建成功后主窗列表刷新、向导生命周期与父窗解耦收口
status: completed
created: 2026-10-06
---

> **实现记录（2026-10-06，feature/wizard-independent-window）**：按 Build order 完成。`window/wizard.ts` 的 `modal` 改 `false`（parent 保留层级跟随），新增导出 `closeWizardWindow()`；主窗 `closed` 事件显式带走向导窗（非模态子窗不随父窗自动销毁的 Electron 行为差异点）。open 单例互斥、创建成功关窗+主窗刷新、Esc/取消路径全部未动。主 plan 设计 3 两处「模态」表述已修订（PRD 经查无模态字样）。真机 CDP 冒烟（dev 6176 + 调试口 9334）全过：向导窗创建、两窗并存、向导渲染正常、单例聚焦不新增窗、主窗 `window.close()` 后向导 target 消失且 app 干净退出（macOS 上若联动失效向导会残留孤儿 target——区分度成立）；向导窗截图留证 /tmp（本地证据）。证据局限如实记录：`bringToFront` 后主窗 `hasFocus=false` 系 CDP 不转移 macOS key window 所致，OS 级「主窗可点击」由 `modal: false` 的框架语义保证，未做系统级点击模拟。274 测试、typecheck/lint 0 错。无 review 发现（改动面两文件+文档）。

> **追加轮（2026-10-06 用户反馈）**：窗口顶部的系统标题条与 Header 右侧 X 去除，改为对齐主窗的原生三灯——`wizard.ts` darwin 加 `titleBarStyle: 'hiddenInset'` + `trafficLightPosition {14,12}`（其他平台保留系统标题栏的关闭钮）；`DeviceWizard.tsx` Header 整行 `-webkit-app-region: drag`（成为窗口拖拽带）、darwin 侧 60px no-drag Spacer 给三灯让位（BoardHead 同模式）、删 X（关闭路径收敛为红绿灯/Esc/底部取消）。视觉冒烟（CDP DOM 断言 + macOS 系统级截图核验）：三灯存在、无标题条、无 X、标题 left=82 不遮挡、Header app-region=drag。

> **追加轮二（2026-10-06 用户反馈）**：红绿灯与标题改居中对齐——Header 由 baseline+padding 改 40px 定高 + `align-items: center`（BoardHead 同构），Heading/StepIndicator 包进组内基线对齐的 TitleGroup；三灯 y 12→14 落板头中线（实测标题中心 19.5 vs 三灯 20，差 0.5px）。CDP 对齐断言 + 系统级截图核验通过。

# 向导独立窗口（非模态） — plan

> 用户需求：新建设备的模态框固定在屏幕上，希望可移动、像独立窗口一样；点击创建后主页面列表更新即可，向导窗口不影响主窗口操作。关联 [emulator-wizard 主计划](2026-10-05-emulator-wizard.md) 设计 3（「保留现有原生模态单例」的本轮调整即修订该点）与 [wizard 窗口单例](2026-10-04-shell-polish-原生向导与板头.md) 的 open 互斥设计。

## Requirements brief

- 作用域：`window/wizard.ts` 的窗口属性（modal、可移动性、层级、生命周期）与两窗并行的交互语义。
- 排除项：向导常驻/多开（保持单例——再点「新建设备」聚焦既有窗）；创建成功后向导不关闭的行为改变（现状创建成功即关窗，用户语义「点击创建之后主页面列表更新就好了」与此一致，保持）；向导内嵌到主窗 tab 的替代形态。
- 边界：创建守卫在 main（陈旧选择重核验）不受窗口形态影响；`wizard:choose-device-skin` 等向导专用通道的 sender 守卫继续以「向导窗 webContents」判定，与模态与否无关。

验收要求：向导窗口可拖动移动、可置前/置后；向导打开期间主窗列表可选中、可启停/删除/重命名设备；主窗再点「新建设备」聚焦既有向导窗；创建成功后向导关闭、主窗按 createdId 选中新设备并刷新（现状行为保持）；主窗关闭时向导窗一起关闭（不留孤儿进程窗口）。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/main/window/wizard.ts` | `modal: false`；`parent` 保留（层级跟随，macOS 仍浮于主窗上方但不阻塞输入）；补「父窗关闭带走向导」的显式联动；open 单例互斥保持 |
| `src/main/window/index.ts`（主窗创建处） | 主窗 `closed` 时若向导窗存活则 `close()`（非模态子窗不随父窗自动销毁——Electron 行为差异点） |
| `src/renderer/src/wizard/WizardApp.tsx`、`DeviceWizard.tsx` | 无必改；Esc 关闭语义（独立窗）保持，验证不受非模态影响 |
| `src/main/devices/index.ts` | 无必改（`devices:changed` 广播本就推全部窗口）；验证并行操作下守卫不受影响 |
| `__tests__/`（wizard 窗口相关若有）与真机冒烟脚本 | 层级/生命周期用例 |

风险：非模态后用户在主窗删除设备与向导创建并行——创建事务原子性已有（writeQueue + 重核验），但「向导打开期间主窗 SDK 状态被改（如未来加 SDK 重置）」属后续能力，本 plan 只验证现有并行面；焦点环（向导打开时主窗仍可键盘操作）需过一遍 Tab 焦点不出窗的预期（Electron 各窗独立焦点，天然满足，验证即可）。

## Design

1. **窗口属性**：`modal: true → false`；`parent` 保留——macOS 上子窗仍跟随主窗层级（浮于其上）但不再吃掉主窗输入；Windows/Linux 上 parent 语义同样保持前置。`resizable/minWidth/minHeight` 等两页布局属性不动。
2. **生命周期收口**：模态子窗随父窗销毁是 Electron 模态行为；非模态后需显式联动——主窗 `closed` 事件里 `wizardWindow?.close()`（与既有 `closed` 清引用/opening 复位逻辑衔接）。向导自身关闭路径（创建成功/取消/Esc）不变。
3. **单例与聚焦**：`openWizardWindow` 的「已开则 focus、opening 互斥」逻辑原样保留——非模态下重复入口的预期就是聚焦既有窗。
4. **并行语义验证清单**（不新增守卫，验证既有面）：向导开 → 主窗启/停/删/改名设备 → `devices:changed` 同时推两窗（向导不订阅列表，无影响）；向导创建中主窗删除另一设备 → 互不阻塞；向导创建成功 → 主窗刷新选中新设备（既有）。
5. **文档修订**：emulator-wizard plan 设计 3 的「保留现有原生模态单例」注记修订为「独立非模态窗口（2026-10-06 用户确认）」；PRD 对应交互描述如有「模态」字样一并更新。

## Build order

1. 窗口属性与父窗关闭联动 + 主 plan/PRD 文案修订。验证：真机可拖动、主窗可交互、主窗关闭带走向导。
2. 并行语义真机冒烟（上面第 4 条清单逐项）+ 创建成功主窗刷新回归。验证：无一并行路径产生错误状态或丢广播。
3. 既有测试回归 + typecheck/lint/prettier；Phase 5/6 book 同步。

## Test plan

- 真机（核心）：拖动窗口；两窗并行操作清单；主窗关闭带走向导；单例聚焦。
- 回归：创建链路（createdId 选中）、Esc/取消关闭、wizard 专用通道 sender 守卫（非模态后主窗仍不可调 `wizard:choose-device-skin`）。
- 自动化：窗口属性断言可加在窗口模块单测（若有）；并行语义以真机冒烟为准（jsdom 无法表达双窗）。

## Done criteria

- 向导可移动且完全不阻塞主窗；全部并行语义与生命周期路径真机通过；创建/关闭回归全绿；两份文档修订落位；book 同步完成。
