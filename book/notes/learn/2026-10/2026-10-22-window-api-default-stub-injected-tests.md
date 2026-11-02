---
description: 组件新增 window.api 读取时，注入式测试用例会因缺 api 桩 TypeError——beforeEach 挂默认桩（含 platform），自挂完整桩的用例自然覆盖
tags: [vitest, testing, electron, preload, react]
---

# 组件新增 window.api 读取 → 注入式测试需要默认 api 桩

- **Scenario**: renderer 组件此前全靠 props 注入（如 DeviceWizard 的注入用例不挂 `window.api`），新功能让组件直读 `window.api.platform` 之类 preload 暴露值——全套测试里所有注入式用例瞬间 TypeError 崩掉。
- **Why**: 注入式用例的哲学是「不给全局桩、只给 props」；组件一旦引入对 preload 的真实依赖，这层假设就破了，而崩溃点在 React 渲染深处（useMemo 内），报错只指到组件行号，不指到哪个用例缺桩。
- **怎么用**: 测试文件头部加 `beforeEach` 挂最小默认桩（本例 `{ platform: 'darwin' }` = mac 现状），保留既有 afterEach 统一拆桩；用例内自挂完整 api 桩者按赋值顺序自然覆盖默认桩。这不是「为过关改测试」——组件新增了真实依赖，桩是测试环境的等价物（BoardHead/LogcatApp 的 `platform: 'darwin'` 桩是同一先例）。
