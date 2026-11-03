---
description: 先将当前 dev 合入 main，再将安装包发布改为仅在同仓库 dev 到 main 的 PR 合并后触发，版本号在 dev 更新
status: completed
created: 2026-11-03
---

# 合入 main 后自动发布

## Step 0：需求简报

- 背景：已有 dev 检查和 release/v* 分支打包流程；用户希望开发先进入 dev，确认后才合入 main 并发布。
- 需求：先将当前 dev 合入 main，再改 CI；仅同仓库 dev 到 main 的已合并 PR 触发发布；用户明确选择在 dev 更新版本号，合入 main 自动发布。
- 范围：首次 main 建立、release.yml、git-policy.yml、版本化发布说明模板、Git 工作流文档、本计划及报告。
- 排除：不改产品功能，不自动增加版本号，不覆盖既有 Release/标签，不保留发布分支或手动按钮触发，不向其他工作分支合并，不添加新凭据。
- 验收：main 已包含原 dev；普通 dev 推送、未合并 PR 及其他来源 PR 不打包发布；合法合并使用精确 merge SHA；新版本生成双平台附件，已有版本安全跳过；PR 和 main 推送的分支检查都通过。

## 阶段 1：分析

远端起初没有 main；本地 main 为旧的 03b13f6，dev 为 1c18da5。合并预演无冲突，实际以 2304f0e 将 dev 合入本地 main，树与 dev 一致，book 检查通过后首次推送 main。该首次建立操作由用户本轮明确授权，旧流程不会因此发布安装包。随后将 main 快进回本地 dev，CI 改动继续在 dev 开发。

现有 git-policy 会拒绝所有非首次 main push，包括 GitHub 正常 PR 合并产生的 push；需核对 push SHA 是否关联同仓库 dev 到 main 的已合并 PR，并要求保留双亲 merge commit。旧 release.yml 的 release/v* 与手动触发需要移除。v1.0.0 已存在，不能重复创建或覆盖。

## 阶段 2：设计

release 使用 pull_request.closed/main 事件，prepare 任务要求 merged=true、head.ref=dev 且 head.repo 为当前仓库。所有 checkout 固定到该 PR 的 merge_commit_sha。prepare 核对 package 与 lock 版本，并查询该版本 Release：不存在则允许构建发布，已发布则跳过构建和发布，查询失败或残留草稿明确失败。

构建与发布复用已有原生双平台流程、asar 检查和 SHA256SUMS。只有发布任务具有 contents:write；生成说明时将模板中的 VERSION 替换为 package 版本。main 的正常 PR 合并由 git-policy 通过关联 PR 和双亲提交核验放行，普通直接推送仍报错。

已有标签但无 Release 时，仅标签精确指向本次 merge SHA 才允许重试发布；其他提交或无法核对的标签明确失败，不将新二进制附到旧源码标签。

权限：git-policy 额外申请只读 pull-requests 权限以核验来源；不扩大写权限。通知：使用 Actions 状态和日志，已有版本跳过写入 job summary，不发送外部消息。幂等：同版本不覆盖；失败可在原合并事件上重跑。

用户已明确下令先合并再实施 CI，且提供具体分支和版本规则，作为本次实施依据；不存在仅为确认而暂停的关卡。

## 执行记录

- [x] Step 0、阶段 1：明确需求，完成原 dev 到 main 的首次合并与推送。
- [x] 阶段 2：触发条件、版本规则、权限和重复版本处理确定。
- [x] 阶段 3：更新 main PR 合并触发、关联 PR 核验、版本化说明模板和 Git 工作流。
- [x] 阶段 4：typecheck、lint、workflow YAML/Bash 检查通过；实际脚本验证版本/锁文件、版本注入拒绝、重复/缺失/草稿/403、标签缺失/同 SHA/冲突/403、十组分支策略、说明渲染及 merge SHA。
- [x] 阶段 5：只读核对来源、权限、精确 SHA、版本幂等和变更范围，未发现新增问题。
- [x] 阶段 6：PR #1 检查全绿后以 400c47c 合并到 main；main 检查及发布工作流成功，已有 v1.0.0 跳过且标签/校验值不变；报告与经验记录同步 dev。

## 远端结果

- 首次建立 main：2304f0e692303a19814b855ae0d564bb432b8754，树与原 dev 一致。
- CI 配置提交：a2cb93a02f1d8988fa076d396aa90628bec97898。
- [PR #1](https://github.com/PZRvm/multi-session-device/pull/1)：6 项检查通过后使用 merge commit 合并，main 为 400c47cf9b40ed9bd31cb979b6056c2e5aa59144。
- [main 推送检查](https://github.com/PZRvm/multi-session-device/actions/runs/41615396834)通过；[合并后发布检查](https://github.com/PZRvm/multi-session-device/actions/runs/41615398533) Success，版本检查执行，已有版本的构建及上传跳过。
- v1.0.0 仍指向 a473b0e，SHA256SUMS 的 SHA-256 仍为 3c632113326a9f4dd45aebefabed0cbfafaa61bcfa4f0569204f82d1e9918e6f；没有新增或覆盖 Release。
- 本地 main、dev 已快进到合并结果；收尾文档提交继续进入 dev，后续随正常 PR 合入 main。
