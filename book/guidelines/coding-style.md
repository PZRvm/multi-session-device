---
description: 编码基线——目录与组件结构、命名、样式与图标、IPC 纪律、错误处理、依赖政策
---

# 编码风格

> review 对着 diff 检查的基线。需要工具强制的（格式化、lint）已接进脚本，这里只引用。

## 语言与工具链

- Electron 39 + electron-vite 5 + TypeScript 5.9 + React 19，包管理只用 npm
- 标准跑法：`npm run typecheck`、`npm run lint`、`npm run dev`；前两个不过不算完成

## 目录与组件结构

- 目录名 = 业务名，主文件一律 `index.ts` / `index.tsx`——main、preload、renderer 三处统一
- 组件放 `renderer/src/components/`，组件名大驼峰
- 组件书写模板（props 解构取用，逻辑在前，底部默认导出）：

```tsx
const DeviceList = (props: DeviceListProps): React.JSX.Element => {
  const { devices, onSelect, ...rest } = props
  return <Wrapper>...</Wrapper>
}

const Wrapper = styled.div`
  /* 只建最外层一个 Wrapper；内部布局写在后代选择器里 */
`

export default DeviceList
```

- 组件 ≥600 行才拆目录：`components/DeviceList/`——`index.tsx` 是主文件，子组件按组件名命名文件，组件私有 hooks 进该目录的 `hooks/`
- 全局 hooks 放 `renderer/src/hooks/`；跨组件状态放 `renderer/src/stores/`（zustand）

## 命名

- 组件、类型、接口：大驼峰；变量、函数、普通文件：小驼峰；模块级常量：全大写下划线（`IPC_CHANNELS`）
- IPC 通道名格式 `域:动作`（如 `dialog:show`），只准出现在 `src/shared/ipc-channels.ts`

## 样式与图标

- 样式只用 styled-components：每个组件只建最外层一个 Wrapper，内部布局用后代选择器，不建第二个 styled
- styled 的动态 prop 用 `$` 前缀（transient props），禁止非 `$` 的 prop 流进 DOM
- 图标一律 lucide-react，禁止 emoji 当图标
- 主题系统（stage 02）落地前，`color-scheme` 锁 `light`，颜色允许临时硬编码；落地后一律走 tokens

## IPC 纪律

- renderer 只经 `window.api` 白名单访问主进程；preload 不暴露原始 ipcRenderer / electronAPI
- 跨进程类型与通道名单源 `src/shared/`，两边都不许手写第二份
- main 侧 handler 先过运行时守卫再进业务；renderer 传来的 payload 一律视为不可信

## 错误处理

- IPC handler 对非法入参直接抛错（invoke 会 reject），不静默兜底
- renderer 调 `window.api.*` 统一经 `renderer/src/api/` 的 `toApiResult` 包装（返回 `ApiResult` 判别联合，reject 不外泄）——未处理的 promise rejection 是 bug

## 格式化与 lint

- prettier 管格式（`npm run format`），eslint 管规则（`npm run lint`）
- 关卡以 `npm run lint` + `npx prettier --check src` 为准；本地工具目录（`.zcode`、`.agents`、`.codex`、`.opencode`）已在 eslint ignores 里，不得移除——移除会让 skills 脚本把全仓跑分污染回 1.6 万条

## 依赖

- 默认不加依赖，除非它删掉的代码比带来的多
- 动技术栈先改 PRD 4.1 并记决策，再动 package.json
