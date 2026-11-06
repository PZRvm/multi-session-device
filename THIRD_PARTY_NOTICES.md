# 第三方版权与许可声明

## BoCode

本项目采用并改编了 [BoCode](https://github.com/Focus695/BoCode) 的部分开发规范、文档模板和维护脚本，主要包括：

- `AGENTS.md` 及 `book/` 中相关的工作流、规范与模板。
- 本地安装的官方四个 skills：`bocode`、`boscope`、`book-writeback`、`bowrite`；保持上游原文，目录由 Git 忽略。
- `scripts/gen-book-index.mjs`：由 BoCode 的 `code/tools/gen-book-index.mjs` 适配。
- `scripts/check-book-clean.mjs`：基于 BoCode 的 `code/tools/check-template-clean.mjs` 改写。

本项目对目录结构、索引用途、检查规则和文案进行了适配。同步基线记录在根目录 `.bocode-version`，升级遵循上游 `UPGRADE.md`；项目自己的发布规则和历史记录保留。

版权所有：Copyright (c) 2026 Focus

许可证：MIT。完整原文见 [licenses/BoCode-MIT.txt](licenses/BoCode-MIT.txt)，上游文件见 [BoCode LICENSE](https://github.com/Focus695/BoCode/blob/dev/LICENSE)。分发上述内容的副本或实质性部分时，应一并保留上游版权声明和许可文本。

上述许可声明适用于源自 BoCode 的内容。本项目原创代码采用根目录 [LICENSE](LICENSE) 中的 MIT 许可证。其他第三方组件与资源遵循各自的许可证。
