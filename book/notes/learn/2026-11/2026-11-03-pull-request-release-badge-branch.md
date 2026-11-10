---
description: 合并 PR 后发布的 badge 分支筛选不等于 checkout 分支，应使用实际运行与 merge SHA 核对
tags: [github-actions, pull-request, badge, no-status, release]
---

# 用实际运行和 merge SHA 核对 PR 发布

- 场景：PR #1 将 dev 合入 main 后，release-installers 的 `branch=main&event=pull_request` badge 显示 no status，而 `branch=dev&event=pull_request` 和只筛 event 的 badge 显示 passing。
- 核对：实际运行 41615398533 为 Success，版本检查任务成功；工作流的三个 checkout 均明确使用该 PR 的 merge_commit_sha，不能把 badge 的分支筛选误当成构建来源。
- 使用：排查时优先查看具体运行、PR 状态及 checkout 的精确 SHA。PR 发布 badge 可按 event 查看；本仓库不能只用 branch=main 的 badge 判断合并后是否执行。
