---
description: styled-components v6 对 styled(自定义组件) 的 ref 转发无类型通道——手动聚焦改用 autoFocus + onFocus 事件替代 ref
tags: [styled-components, react-19, ref, focus, typecheck]
---

# styled-components v6 不给 styled(自定义组件) 的 ref 类型

- **Scenario**: DeviceRow 行内重命名要「输入框出现即聚焦全选」，写成 `styled(Input)` 包一层再传 `ref`——typecheck 报 TS2769 `Property 'ref' does not exist`（styled-components v6 的 props 类型把 `ref` 连同 `key` 一起 Omit 了，即使 React 19 已支持 ref 作为普通 prop）。
- **Why**: styled() 的类型层对自定义组件（非 DOM 标签）不暴露 ref 通道；React 19 的 ref-as-prop 运行时能力被 v6 类型挡住。绕法有二：给 Input 套 forwardRef（改公共组件），或不用 ref。
- **How to apply**: 「挂载即聚焦全选」这种一次性聚焦不需要 ref——`autoFocus` 负责聚焦，`onFocus={(e) => e.target.select()}` 负责全选，两行替代整个 `useRef + useEffect`。ref 只在「聚焦后还要持续操作 DOM」时才值得为此给基础组件开 forwardRef。
