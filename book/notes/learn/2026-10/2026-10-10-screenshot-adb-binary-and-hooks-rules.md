---
description: 截屏批三个实现经验——exec-out 二进制必须 Buffer 版 runner（runAdb utf8 化毁字节）、互斥检查与占位间不得夹 await、react-hooks 新规则用渲染期派生替代 effect setState
created: 2026-10-10
tags: [electron, adb, exec-out, binary, ipc, react-hooks, race, mutex, vitest]
---

# 截屏批：exec-out 二进制流 / 互斥占位时序 / react-hooks 新规则

来源：plan 2026-10-10-screenshot-clipboard-save 实现批（feature/screenshot-clipboard-save）。

## 1. `adb exec-out` 二进制输出不能过 `runAdb`——stdout 必须 Buffer

- **Scenario**: 用 adb 拉取设备上的二进制（`exec-out screencap -p` 的 PNG、`exec-out` 拉文件等）。
- **Why**: `src/main/emulator/adb.ts` 的 `runAdb` 把 stdout 收完就 `toString('utf8')`（文本命令的场景），PNG 过这层会被 UTF-8 解码破坏，写出的文件必坏。中文/代理对字节落在 PNG 魔数与压缩流里，损坏是静默的——签名校验（前 8 字节 PNG magic）能兜住，但没有校验就会流入剪贴板。
- **How to apply**: 二进制场景自持 runner（`src/main/screenshot/index.ts` 的 `runAdbBinary`）：spawn 后 chunks 收 `Buffer[]`、`Buffer.concat` 返回；镜像 runAdb 的超时/SIGKILL 结构，按负载加体积护栏（截图 32MB）。文本场景继续用 runAdb，不要为二进制改它的返回类型——两个 runner 并存是有意分层。

## 2. 互斥「检查→占位」之间不能夹 await——测试先行抓的时序洞

- **Scenario**: IPC handler 里做每资源互斥（截屏每设备一把锁）。
- **Why**: 初版写法 `if (locks.has(id)) throw; await 查设备; locks.add(id)`——检查在 await 前、占位在 await 后。两次快速 invoke 都能通过检查（第一个还没执行到 add），双双进入临界区；测试里表现为第二次调用不是被拒而是永远 pending（run 桩被第二个调用重新赋值 resolve）。
- **How to apply**: 占位必须**同步**完成：`if (has) throw; add; try { await... } finally { delete }`。判据一句话：`has` 检查与 `add` 之间不允许出现任何 await。这个 bug 单测一跑就现形（互斥用例超时），是「测试先行」的直接收益——肉眼 review 这种时序很容易放行。

## 3. react-hooks 新规则：渲染期写 ref 与 effect 内同步 setState 都会被 lint 拦——用渲染期派生替代

- **Scenario**: hook 里需要「最新状态快照」（save 时读当前 phase）+「props 变化时重置 UI」（设备停止收起气泡）。
- **Why**: 本仓库 eslint 的 react-hooks 规则会拦两个老写法：① 渲染期 `stateRef.current = state`（`react-hooks/refs`：Cannot access refs during render）；② effect 里同步 `setState`（cascading renders）。
- **How to apply**: ① 快照 ref 改在 `useEffect(() => { ref.current = state }, [state])` 里提交后同步——事件处理器里读它时提交早已发生，语义不损。② 重置类需求改**渲染期派生**：`const visible = condition ? raw : IDLE`，不写 reset effect；配 key 化挂载（DeviceCanvas 以 `id:runId` 为 key）保证跨运行无残留。两招都不新增 effect、不丢 React 数据流。
