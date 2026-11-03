---
description: App.logcat.test.tsx 的「dock 默认收起；点击展开并订阅，再点收起退订」用例在整仓并行跑时偶发失败（单独跑稳定通过），2026-10-13 两个不同批次各中一次
created: 2026-10-13
status: resolved
---

# App.logcat dock 测试整跑偶发抖动

## 问题

`src/renderer/src/components/__tests__/App.logcat.test.tsx > 主窗日志 dock > dock 默认收起
（不持久化）；点击展开并订阅，再点收起退订` 在 `npm test` 全量并行执行时偶发失败
（断言 dock 状态未如期变化），单独 `npx vitest run` 该文件稳定通过。2026-10-13
真机第一批与工具条对齐批的全量门禁各命中一次，均重跑即绿。

## 复现

难以稳定复现：`npm test` 整跑（jsdom 92 文件并行），观察该用例间歇性失败；单文件跑
不失败。疑似与其他文件共享 worker/计时器竞争相关（该用例含 fake timers 与订阅时序）。

## 建议方向

- 用 `pool: 'vmThreads'`（vitest 提示的每文件隔离方案）整跑验证是否消失。
- 或检查该用例的 fake timers 与 React act 边界——展开/收起断言前是否漏了一个微任务拍。

## 处置（2026-10-13）

根因：收起/聚焦链是「isWindowOpen IPC → setLogDockOpen → 卸载 effect → unsubscribe」
多个微任务拍，原断言前只 `await Promise.resolve()` 固定一拍——单文件时微任务队列浅、
恰好在拍内收敛，整仓并行时队列深一拍即抖。修法：全文件五处固定拍数的
`await act(async () => { await Promise.resolve() })` 改为 `waitFor` 轮询（断言不变），
与既有 `findByRole` 的轮询风格一致。整仓连跑三次全绿（1180×3）。

## 2026-11-02 补充观察

Windows 取消通栏布局的测试先行批次中，三平台参数化的 darwin 日志默认收起用例出现一次状态断言失败；同批六个布局规格断言也按预期失败。随后相关三个组件文件 65 项与扩展五文件 76 项分别通过。该次时序现象未单独定位，不改变上面的既有修复结论，也不声明新的修复；若再次出现，按新样本核对 IPC 结果与 React 提交边界。
