---
description: 删除独立 e2e 与录屏实验脚本，保留六个必要工具，并在三语 README 中致谢 BoCode
---

# 清理实验脚本并致谢 BoCode

用户希望清理 GitHub 上的 e2e、scripts 目录并致谢 BoCode。核对后发现 scripts 中有实际被打包和 CI 使用的工具，用户选择保留必要脚本，只删除 e2e 与实验内容。

本次移除 `e2e/cdp-smoke.mjs` 及 `scripts/recording-poc/`，共 23 个文件。保留签名、asar 校验、真实模拟器配置检查、book 索引、卫生检查及提交主题检查六个工具，package.json、打包配置、hook 和 CI 入口原样保留。

简体、繁体和英文 README 各补一条 BoCode 致谢，说明其开发工作流、文档模板和知识库维护脚本贡献。录屏 PoC 报告的探针链接改为删除前提交的 GitHub 固定链接，旧实验结果和代码仍可从历史查阅。

typecheck、lint、README 格式与本地资源链接、book 索引和卫生检查均通过。已逐字节核对六个必要脚本及其调用配置未改动；只读评审未发现新增问题。本次未改产品源码，也未运行硬件实验或重新打包。

变更通过 dev 的普通提交同步 GitHub，保留既有提交历史。完整范围与验证见[清理计划](../../../plans/2026-11-03-repository-tools-cleanup.md)。
