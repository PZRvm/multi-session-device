---
description: vitest 5 的 vi.fn 泛型改成单个函数类型参数——旧写法 <Args, Return> 报 TS2558 Expected 0-1 type arguments
tags: [vitest, typescript, mock, migration]
---

# vitest 5：vi.fn 泛型只收一个函数类型参数

- **Scenario**: 按 vitest 3/4 的老习惯写 `vi.fn<[id: string], Promise<Device[]>>()`，typecheck 报 TS2558 `Expected 0-1 type arguments, but got 2`；`mockResolvedValue` 的参数类型也随之推成 `never`。
- **Why**: vitest 5 把 `vi.fn` 的双泛型 `<Args, Return>` 合并成了单函数签名泛型 `vi.fn<T extends Procedure>`。
- **How to apply**: 写成 `vi.fn<() => Promise<Device[]>>()`——把整个函数签名作为一个类型参数；带实现则 `vi.fn<(cb: unknown) => () => void>(() => () => {})`。参数类型推断、`mockResolvedValue` 校验都从这个签名来。 RTL 配合 `Mock<T>` 类型标注 handler 时同理：`Mock<(running: boolean) => void>`。
