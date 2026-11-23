---
description: GitHub 待发布草稿须通过有写权限的分页 Releases 列表定位，再以合并 SHA 和产物摘要核对
tags: [github, release, draft, 404, installer]
---

# GitHub 发布草稿需要从 Releases 列表查询

GitHub 的 `GET /releases/tags/{tag}` 只查询已发布版本。使用它查刚上传的草稿会得到 404；发布任务应使用有仓库写权限的令牌，在分页 Releases 列表中按完整 Tag 查找，再用唯一 Release ID 发布。 [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-a-release-by-tag-name)

要恢复一个已上传的草稿，从原合并事件下载两平台产物，用正式公钥重验签名，重算附件摘要并核对草稿的目标 SHA、正文和附件。通过这些核对后，`scripts/publish-update-release.mjs <已验证目录> --resume-draft` 可以继续发布原草稿。缺少附件、摘要不同或存在多份同名记录都会中止。
