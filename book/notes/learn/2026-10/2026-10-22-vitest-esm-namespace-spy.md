---
description: vitest 里 vi.spyOn 打不通 node 内置模块的 ESM 命名空间——要么整模块 vi.mock，要么给被测函数留接缝参数
tags: [vitest, node, child_process, testing]
---

# vi.spyOn 打不通 node 内置模块的 ESM 命名空间

- **Scenario**: 单测要断言某个函数内部发起的子进程命令形态（如 `taskkill /PID <pid> /T /F`），想 `vi.spyOn(childProcess, 'spawn')` 拦截。
- **Why**: vitest 下 `import * as childProcess from 'node:child_process'` 拿到的是 ESM 模块命名空间对象，其属性不可配置——`vi.spyOn` 直接抛 `TypeError: Cannot spy on export "spawn". Module namespace is not configurable in ESM`（本仓库 2026-10-22 windows-process-mgmt 施工实测）。CJS 依赖可以这么 spy，node 内置模块不行。
- **怎么用**: 两条路按影响面选——只需要拦一个函数的内部调用时，给被测函数留接缝参数（`defaultKillTree(pid, spawnFn = spawn)`），测试注入假实现，模块其余测试零影响；要拦的是模块级多处调用时才用 `vi.mock('node:child_process', async (importOriginal) => ({ ...actual, spawn: mock }))` 整模块替换（影响同文件所有测试，慎用）。
