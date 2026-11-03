# AGENTS.md

AI agent 在公开源码仓库工作的入口规则。

## 项目结构

- Electron 应用（electron-vite + React + TypeScript），源码在 `src/`。
- `src/main/` 管理设备、SDK、窗口、媒体与 IPC；`src/preload/` 提供白名单桥；`src/renderer/` 为 React 界面；`src/shared/` 为共享类型与契约。
- 功能、平台状态和开发命令以三语 README 为准。此发布副本不包含内部 `book/` 知识库及其历史。

## 开发规则

- 动代码前说明需求、范围和验收方式，再分析、设计、实现、测试、评审、收尾。
- 只改任务范围内的代码，不做顺手重构或引入无关抽象。
- 评审与收尾中发现的范围外问题只记录，另行处理。
- 界面文案修改同步简体中文、繁体中文和英文。
- 提交前运行 `npm run typecheck`、`npm run lint` 和相关测试；构建使用 `npm run build`。

## Git 与许可

- 小改动验收后进入 `dev`；`main` 只接收来自 `dev` 的 PR，不直接推送。
- 提交主题遵守 Clean Commit，使用 `node scripts/check-commit-message.mjs "<主题>"` 校验；启用 hook：`git config core.hooksPath .githooks`。
- 本项目采用根目录 LICENSE 中的 MIT 许可；保留 THIRD_PARTY_NOTICES.md 与上游许可文本。
