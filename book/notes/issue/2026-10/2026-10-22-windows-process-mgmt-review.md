---
description: P3 进程管理 Windows 化代码评审发现——无 P1；P2 两条（测试平台假设钉住、会话结束弹窗暴露面）+ P3 四条；只记录不修
---

# Windows 进程管理（P3）代码评审发现

- **评审输入**：feature/windows-process-mgmt（4189850 起，基 dev c77fbe4）src 侧全量 diff；门禁状态 1327 测试全过 / typecheck 0 错 / lint 0 问题；mac 冒烟已由用户确认。
- **纪律**：只记录，不顺手修——修复是下一轮独立工作（对照 2026-10-06-download-cancel-review 的修复轮模式）。

## P2（应修，建议进修复轮）

- **P2-1 测试套件的平台隐含假设**：`runner.test.ts` 的 `makeRunner` 基线不注入 `platform`，`#isWin32()` 落到真实 `process.platform`——整套 runner 既有用例隐含「测试机必为 POSIX」。后果：统一集成验证阶段在 Windows 真机跑 `npm test`（既定动作）时，既有用例会走 win32 分支：FakeChild 永不被信号杀死、未注入 killTree 时 `defaultKillTree` 会真 spawn taskkill 杀假 pid 4321 → 失败 → 两次 3s 宽限后 `runnerStopTimeout` → 停止/退出清理域大面积超时红。修法一行：`makeRunner` 基线显式 `platform: 'darwin'` 钉住（win32 用例已显式 override，不受影响）。
- **P2-2 win32 会话结束也会触发确认弹窗**：系统关机/注销走 `before-quit` → `confirmQuitIfNeeded` 弹模态框，可能挂住关机（Windows 显示「这些应用阻止关机」）。既有 `quitCleanup` 弹窗同暴露面（既有问题，不扩面），但本弹窗触发条件更宽（有设备在跑即弹）。建议：真机验收补「点开始菜单关机」剧本；若需旁路，方向是 Windows 专属 `session-end` 事件区分会话结束与用户主动退出（electron 文档：session-end 仅 Windows）。

## P3（可顺延，记录在案）

- **P3-1 win32 停止最坏收口 14s**（树杀失败 3s 宽限 + 3s 间隔 + 二次失败 3s 宽限 + 5s 收口宽限）> posix 8s。`disposeAll` 多台并行（`Promise.allSettled`）不受单台时长拖累，接受并记录；若修复轮顺手，把两次树杀的间隔宽限合并缩短即可。
- **P3-2 `defaultKillTree` 错误串不走 i18n**（`taskkill: <code>`）：诊断串，用户可见面已由上层 `runnerStopTimeout` 的 msg() 收口；保持现状。
- **P3-3 测试覆盖缺口**：win32 `alive=false`（子已自退）跳过 killTree 直接等收口的分支无显式用例；win32 `disposeAll` 无显式用例（经 `#terminateEntry` 间接覆盖）。修复轮补两条即可。
- **P3-4 ask 接缝的 options 形状双份维护**：`QuitConfirmDeps['ask']` 参数形状与默认实现展开 `type/icon` 后传给 `showMessageBox` 的形状靠人工对齐；单测已断言关键字段，风险低。

## 结论

无 P1（阻断级）问题；posix 路径逐字节未动、无安全面新增（taskkill 参数为数字化 pid，无注入面）。P2-1 建议与 issue 2026-10-22-windows-quit-stay-no-window（second-instance 唤回）同批进 P3 修复轮，两者都在 Windows 真机验收前完成即可。

## 修复记录（2026-10-22 修复轮）

- **P2-1 已修**：`makeRunner` 基线钉 `platform: 'darwin'`，套件平台无关。
- **P2-2 已修（防御性）**：`browser-window-created` 统一挂钩 BaseWindow 级 win32 专属事件 `query-session-end`/`session-end` → `markSessionEnding()`；`confirmQuitIfNeeded` 会话结束时恒放行不弹窗（`sessionEnding` 接缝可测）。保留真机验证项：关机/注销时「会话结束先于 before-quit」的行为随 Windows 版本而异，开始菜单关机剧本仍需真机裁决。
- **P3-1～P3-4 未修**（按纪律顺延；修复轮范围仅 P2）。
