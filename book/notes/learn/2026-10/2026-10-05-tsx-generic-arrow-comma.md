---
description: tsx 里泛型箭头函数必须写 <T,>——裸 <T>( 被解析成 JSX 起始标签，连环假错报到几百行外的 styled 段
tags: [typescript, tsx, react, generics, gotcha]
---

# tsx 泛型箭头函数的 `<T,>` 陷阱

- **Scenario**: 在 `.tsx` 文件里写组件外的泛型箭头函数（如自定义 hook `const useX = <T>(fetcher: () => Promise<T[]>) => …`），typecheck 报一串 `TS1381/TS17008/TS1005`（Unexpected token、JSX element has no corresponding closing tag），报错位置落在几百行外的 styled-components 模板串里，看似样式段坏了。
- **Why**: tsx 里 `<T>(` 被解析为 JSX 起始标签 `<T>`，从这里开始整个文件的解析就歪了，后续报错全是假错；真正的首错只在 `<T>(` 那一行（`JSX element 'T' has no corresponding closing tag`）。
- **How to apply**: 泛型箭头写 `<T,>`（逗号消歧）或改 `function` 声明；排查这类连环错先看**第一条**错误的位置，别从尾部报错入手。测试文件里 `vi.fn<() => Promise<T[]>>()` 不受影响（尖括号不在表达式起始位）。
