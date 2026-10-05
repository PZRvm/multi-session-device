---
description: ipcMain.handle 的 handler 改 async 后，非法入参不再同步抛错而是 reject——测试断言要从 toThrow 换 rejects.toThrow
tags: [electron, ipc, vitest, async, testing, pitfall]
---

# async IPC handler 的非法入参断言：rejects.toThrow 而非 toThrow

- **Scenario**: 主题域 handler 从同步函数改成 `async`（要 await 落盘），沿用 `expect(() => handler({}, 'auto')).toThrow()` 断言非法入参。
- **Why**: async 函数永不同步抛错——throw 变成 rejected promise，同步断言既判不出错、又留下一串 unhandled rejection 噪音（本次 10 个用例全红才暴露）。
- **怎么用**: `await expect(handler({}, 'auto')).rejects.toThrow('非法的 mode')`，「不碰内存/不落盘」等副作用断言留在 await 之后。renderer 侧 fire-and-forget 调用方（toApiResult 模式）不受影响——reject 本来就是它们接错误的方式。
