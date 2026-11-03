---
description: 清理 GitHub 上的 e2e 与脚本目录，同时保留必要构建和检查能力，并在三语 README 致谢 BoCode
status: completed
created: 2026-11-03
---

# 仓库目录清理与 BoCode 致谢

## Step 0：需求简报

- 背景：用户认为公开仓库的 e2e/、scripts/ 无用，希望移除，并补充 BoCode 致谢。
- 需求：清理这两个目录，在三语 README 致谢中加入 BoCode 链接及其实际贡献，提交并推送 dev。
- 范围：目录内容及直接引用、打包与检查入口、README、必要的规则和许可路径说明、本计划及收尾记录。
- 排除：不改产品功能，不清洗旧历史，不降低现有构建和检查能力，不修范围外问题，不推 main。
- 验收：采用用户确认的目录方案；现有必要命令可用、无活跃入口断链；三语致谢一致；本地与远端 dev 一致。

## 阶段 1：分析

e2e 只有独立 CDP 冒烟脚本。scripts 包含录屏 PoC，以及实际被 package.json、electron-builder、Git hook 和 CI 引用的六个工具：签名、asar 校验、真实模拟器配置检查、book 索引、book 卫生检查、提交主题检查。直接删除整个 scripts 会破坏这些能力。

THIRD_PARTY_NOTICES.md 已说明 BoCode 提供开发规范、文档模板和维护脚本，并保留其 MIT 原文；README 致谢据此书写，不增加未核实的贡献。

## 阶段 2：设计

用户选择方案 2：保留 scripts 中的六个必要工具，只删除 e2e/cdp-smoke.mjs 和 scripts/recording-poc/。package.json、electron-builder、Git hook、CI 及其调用路径不变；历史提交保留这些实验文件，不清洗历史。

三语 README 增补 BoCode 致谢。录屏 PoC 报告中的探针链接改为删除前提交 0e1b24a 的 GitHub 固定链接，保留历史证据的可查性；其他历史命令和实验结果不改写。

## 执行记录

- [x] Step 0、阶段 1：核对需求、干净工作树及目录依赖。
- [x] 阶段 2：用户选择方案 2，明确删除范围及历史证据链接处理。
- [x] 阶段 3：删除 e2e 和录屏 PoC 共 23 个文件，保留六个必要工具及全部调用入口，三语 README 致谢 BoCode。
- [x] 阶段 4：typecheck、lint、README 格式与资源链接、历史证据目标、索引及卫生检查通过；必要脚本和打包/CI/hook 入口与原提交逐字节一致。
- [x] 阶段 5：只读核对删除清单、三语致谢及证据链接，未发现新增问题。
- [x] 阶段 6：完成功能报告、计划与索引，随 dev 常规提交同步 GitHub。
