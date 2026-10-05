---
description: fast-xml-parser v5 默认忽略 XML 属性——@_path/@_unit 静默丢失，manifest 解析出 0 条且不报错；vitest 只转译不做类型检查，运行时 undefined 缺陷会漏网
tags: [fast-xml-parser, xml, vitest, typescript, gotcha]
---

# fast-xml-parser v5 默认丢属性 & vitest 不做类型检查

- **Scenario**: 用 fast-xml-parser 解析官方 sys-img manifest（`remotePackage path="..."`）和设备 XML（`ram unit="MiB"`），解析结果里 `@_path`/`@_unit` 全是 undefined——276 条清单解析成 0 条，且**不报错**；另一处把 `{ diagonalInches }` 塞在 `meta.screen` 里却按顶层字段读，vitest 26 个用例照常全绿，直到 `npm run typecheck` 才现形。
- **Why**: v5 把 `ignoreAttributes` 默认值翻成了 `true`（v4 是 false）——升级语义静默变化，属性全被剥掉；vitest 走 esbuild 只转译不查类型，`undefined` 在宽松比较里一路漏（`undefined !== null` 为 true、`undefined >= 7` 为 false，分支照样走）。
- **How to apply**: fast-xml-parser 显式写 `ignoreAttributes: false`（属性承载包身份/单位时必写）；解析类模块的用例要断言**解析出的条数与字段值**（而不是只断言不抛错）；类型缺陷靠 `npm run typecheck` 兜底——main/renderer 两侧全绿不等于类型正确，改完共享类型先跑 typecheck 再跑 vitest。本仓库两处 parser 都补了注释提醒 v5 默认值。
