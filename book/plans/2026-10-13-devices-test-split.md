---
description: 把 devices/__tests__/index.test.ts（3359 行、120 用例）按 describe 块拆到 8 个 <模块名>.test.ts + 共享 harness.ts，对齐 emulator 测试惯例；断言零削弱、总数不变
status: completed
created: 2026-10-13
---

# devices 域测试文件拆分 — plan

前序：源码拆分（[2026-10-13-main-devices-emulator-split](2026-10-13-main-devices-emulator-split.md)）已完成，测试按用户批复作为后续单独任务执行。同日先清掉了存量 lint（issue 2026-10-13 销账，commit 3ca39e1）。

## Step 0

- Background：3359 行单测试文件混合 12 个 describe 块；源码已拆 10 模块，emulator 惯例是 `<模块名>.test.ts` 一一对应。
- Scope：仅 `src/main/devices/__tests__/`；共享前导（vi.hoisted mocks + 18 个 vi.mock + freshDomain 等 5 个助手）抽 `harness.ts`。
- Does NOT affect：断言与用例逻辑零改动；mock 语义不变（每文件独立 harness 实例 = 比单文件更严的隔离）。

## 设计

- **vi.mock 移入 harness.ts 可行性**：被测模块全部经 `freshDomain()` 内动态 `import('..')` 加载，静态导入 harness 即完成 mock 注册（先于任何动态 import）；mock 相对路径在 `__tests__/` 目录内不变。
- **每文件 `// @vitest-environment node` 头**（vitest 默认 jsdom，原文件即 node 覆盖）。
- **块→文件映射**（describe 整块搬移，不切开）：
  - create.test.ts ← 创建/删除事务（373-927）+ 包操作互斥（1005-1039）
  - lifecycle.test.ts ← quickDevice+Quick Boot（928-1004）+ 启停状态机（1072-1424）
  - queries.test.ts ← 引用守卫（1040-1071）+ runningDeviceSerial（3321-3359）
  - startup.test.ts ← 摄像头核验（1425-1508）+ 皮肤尺寸（3227-3320）
  - ipc.test.ts ← sender 白名单与退出清理（1509-1561）
  - persistence.test.ts ← 持久化对账（1562-1915）
  - scan.test.ts ← 对账 review 修复轮（1916-2125）
  - edit.test.ts ← 配置编辑域含四个嵌套块（2126-3226）
- **风险**：单文件时代若某块依赖更早块泄漏的 mock 实现状态（beforeEach 只 clearAllMocks 不 resetAllMocks），拆分后该块可能失败——表现为缺种子，修复方式是给该块 beforeEach 补种子（不削弱断言）。

## 验收

typecheck + lint + 全量 vitest；devices 域用例总数保持 120、全仓 1139 通过。
