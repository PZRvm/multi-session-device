---
description: dev 已先合入 main，新发布流程经 PR #1 生效，仅 dev 到 main 的 PR 合并触发，版本在 dev 维护
---

# 合入 main 后自动发布

用户希望开发先进入 dev，确认后才合入 main 并发布，同时要求先同步现有 dev，再调整 CI。版本号由用户在 dev 维护，不自动递增。

本次先将现有 dev 合入旧的本地 main，首次推送远程 main，提交为 2304f0e，文件树与 dev 一致。随后在 dev 修改 workflow，经 [PR #1](https://github.com/PZRvm/multi-session-device/pull/1) 的 6 项检查后，以 merge commit 400c47c 合入 main，保留所有原提交。

## 新流程

普通 dev 推送只运行仓库检查。安装包工作流只响应 main PR 的 closed 事件，并要求同仓库 dev 来源且已经合并；未合并 PR、其他来源、旧 release/v* 分支和手动按钮均不发布。

新版本先在 dev 执行 `npm version patch --no-git-tag-version`，提交 package.json 与 package-lock.json，再创建 dev 到 main 的 PR，选择 Create a merge commit。工作流固定构建该次 PR 的 merge SHA，校验 macOS ARM64 DMG、Windows x64 EXE，生成 SHA256SUMS 后自动创建 Preview Release。

已有已发布版本跳过构建和上传，不覆盖附件。草稿、API 查询失败、锁文件版本不一致及标签指向其他提交均明确报错。Git 策略同时修正为允许合法 PR 合并产生的 main push，通过关联 PR 和双亲提交核验来源；平台分支保护没有在本次变更中设置。

## 验证结果

typecheck、lint、book 索引/卫生检查、YAML 与 Bash 语法检查通过。隔离执行实际 workflow 脚本，覆盖版本一致性、注入拒绝、版本重复/缺失/草稿/API 拒绝、标签匹配/冲突、十组分支来源与合并策略，以及说明渲染和精确 SHA。

[main 推送检查](https://github.com/PZRvm/multi-session-device/actions/runs/41615396834)通过；[合并后发布工作流](https://github.com/PZRvm/multi-session-device/actions/runs/41615398533) Success，总耗时 11 秒，版本检查执行成功。此次仍为已发布的 1.0.0，因此跳过重复打包上传；原 v1.0.0 标签和 SHA256SUMS 保持不变。新版本分支已用隔离脚本验证，原生打包步骤沿用此前双平台成功的配置，未为验收擅自提升版本或重发安装包。

本次未改产品功能。收尾文档进入 dev，main 保留已经通过 PR 验收的配置；下一次正常开发仍从 dev 开始。完整规则见 [Git 工作流](../../../guidelines/git-workflow.md)，实施范围见[本次计划](../../../plans/2026-11-03-main-merge-release.md)。
