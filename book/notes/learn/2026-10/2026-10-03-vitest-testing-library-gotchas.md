---
description: vitest + testing-library 两个必踩坑——RTL 自动 cleanup 依赖全局 afterEach，受控组件测试要用 useState Harness 回灌 value
tags: [vitest, testing-library, react, controlled-component, cleanup, gotcha]
---

# vitest 写 RTL 测试的两个必踩坑

- **Scenario**: 在 vitest（未开 `globals: true`）里用 @testing-library/react 写组件交互测试：报 "Found multiple elements"（重复元素）；或测受控组件时点/按键后 aria 状态永远不动。
- **Why**: ① RTL 的自动 cleanup 靠全局 `afterEach` 注册，vitest 默认不开 globals，每次 `render` 都往 document 里堆一份；② 受控组件的 `value` 来自父级——测试里喂 `vi.fn` 假 onChange，选值永远回不到 `value`，组件看起来"没反应"，其实是数据流断了。
- **How to apply**: ① 每个测试文件头 `afterEach(cleanup)`（import 自 RTL + vitest）；② 测键盘/交互行为时包一层 `useState` Harness 镜像真实数据流（`<SegmentedControl value={value} onChange={setValue} />`），只有断言回调参数时才用 `vi.fn` 直测。骨架见 `src/renderer/src/components/__tests__/SegmentedControl.test.tsx`（2026-10-03 起测试同目录共置于 `__tests__/`）。
