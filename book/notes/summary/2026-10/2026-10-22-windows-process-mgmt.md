---
description: Windows 进程管理落地——runner 树杀 taskkill /T、win32 不 detached、关窗确认弹窗；win32-only 分支 mac 零回归
---

# Windows 进程管理（P3）功能报告

## 背景

项目一期宿主是 macOS，Windows 支持未排期。前期调研（think-report 20261022110137 §2）确认了三个 Windows 进程层面的缺口：负 PID 进程组终止是 POSIX 专属（回退只杀直接子进程会留孤儿 qemu 占端口和 AVD 锁）、`detached: true` 在 Windows 会开新控制台且与 `windowsHide` 冲突（nodejs/node#21825）、关窗即退出（Windows 惯例）会顺手停掉全部模拟器。用户拍板：不做托盘，但关窗时有设备在跑要先弹确认框。

## 做了什么

- `runner.ts`：停止路径加 win32 分支——`taskkill /PID <pid> /T /F` 整树硬杀（`defaultKillTree`，带 spawn 接缝），非零退出先给 3 秒宽限（多为子进程刚自退的竞态）、仍有界间隔重试一次，失败保留 entry 供重试（口径与 posix 限期不退一致）；`spawnEmulator` 的 `detached` 改为 posix-only，两平台恒加 `windowsHide: true`。posix 的负 PID + SIGTERM→SIGKILL 梯子逐字节未动。
- 新增 `src/main/quit-confirm.ts`：win32 且有本工具启动的设备在跑时弹原生确认（留在应用 / 退出），接缝注入可单测；`index.ts` 的 `before-quit` 序列在清理链之前接入，留在应用直接折返、`quitPending` 由既有 finally 复位。
- i18n：`quitConfirm*` 四键三语（多出的第四键是「退出」按钮——「留在应用」复用既有 `quitStayButton`）。

## 为什么这么选

树杀没有引 tree-kill 包——它只是 `taskkill /T` 的封装，自写约 20 行且可按仓库接缝风格注入单测。win32 首期无优雅层是如实的取舍：`-no-window` 模拟器无消息循环，`taskkill` 不带 `/F` 发不出 WM_CLOSE，优雅退出归 emulator console kill（backlog A2）。确认弹窗放在清理链之前（而不是复用停失败才弹的 leftovers 仲裁框）——两道弹窗语义不同：一个是「停前确认」，一个是「停失败仲裁」。

## 结果

全套 1327 测试通过（新增 12：runner win32 树杀 7 + quit-confirm 5）、typecheck 0 错、lint 0 问题；mac 侧既有用例零改动。两个实现期偏差（记录于 plan 实现记录）：确认逻辑抽成独立小模块 `quit-confirm.ts`（index.ts 副作用重、不可直测，dialog 域是 IPC 注册模块不合适）；i18n 按文案正确性落了四键而非 plan 预告的三键。

## 后续

Windows 真机集成验证（多开关窗弹窗与孤儿进程检查、taskkill 真实行为）归六份计划后的统一集成阶段；A2 优雅退出（console kill）与托盘仍在 backlog。
