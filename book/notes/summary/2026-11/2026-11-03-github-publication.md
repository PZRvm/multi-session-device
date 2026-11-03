---
description: 将含 MIT 许可的 472 文件快照首次发布到 GitHub dev，保留本地历史并排除 book
---

# 首次公开发布

> 本文记录首次快照发布。用户随后允许 book 公开并要求保留原提交；当前流程以[完整历史对齐计划](../../../plans/2026-11-03-github-history-sync.md)为准，不再使用独立发布目录同步。

用户指定公开仓库 `https://github.com/PZRvm/multi-session-device`，要求上传项目，并已选择 MIT。

三语 README、图标和本地徽章随源码发布；本次补齐 MIT 包元数据及第三方声明中的原创代码许可说明。卫生检查支持无 book 的公开副本，仍检查 Git 跟踪的垃圾文件；公开副本 AGENTS.md 改为适用于源码仓库的说明。

book 已进入本地历史，直接推送会一并公开。为保留开发历史，本次从工作树复制全部 Git 跟踪文件及未忽略的新文件，排除 book，在独立目录生成首个公开提交。包括现有未提交的截图编辑器、开发端口修复及测试；原开发仓库不提交、不改分支、不配置公共 origin。

## 发布结果

- 仓库：https://github.com/PZRvm/multi-session-device
- 分支及远端默认分支：dev。
- 公开提交：`5748ed85857f54f886a0d553e9eb57467928d835`。
- 发布目录：`/Users/pangzerui/foreunit/multi-session-device-publish-f5pwjs9t`。
- 发布目录 origin 读取使用 HTTPS，推送使用本机现有 SSH；HTTPS 无可用登录凭据，SSH 推送成功，未强推。
- 472 个文件，单一根提交，当前树及全部可达历史均无 book。远端 HEAD、dev 与本地提交一致；GitHub API 确认为公开仓库。
- 发布目录工作树干净。以后同步需将开发工作树的公开内容更新到该目录，在其 dev 分支提交推送，不能直接推开发仓库历史。
- 发布清单和源文件 SHA-256 保存在发布目录 `.git/publication-manifest.json`，不上传。

## 验证

typecheck、lint、build 均通过。首次全量测试有一条 Logcat 订阅断言失败，单独重跑及全量复跑通过，最终 1560 项通过、6 项跳过。

公开副本逐文件核对源内容，只有 AGENTS.md 按设计改写。三语 README 本地资源存在，MIT 正文与元数据已核对；未检出明显凭据、疑似凭据文件或超限文件。卫生检查已验证无 book、垃圾文件拒绝、有 book 索引成功与失败四个分支，本地 book 索引检查通过。

远端 git-policy 首轮工作流已完成，结论为 success。[工作流](https://github.com/PZRvm/multi-session-device/actions/runs/41606498938)

本次评审和收尾发现的测试偶发失败、hook 执行权限和旧产品说明问题只记录，见[后续检查项](../../issue/2026-11/2026-11-03-publication-review.md)。[发布计划](../../../plans/2026-11-03-github-publication.md)记录范围与过程。
