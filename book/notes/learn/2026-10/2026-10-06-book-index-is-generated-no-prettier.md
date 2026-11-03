---
description: book/README.md 是索引生成物——对它跑 prettier 会让 release-check 判「索引过期」，收口只跑 book:index 直接提交
tags: [book, index, prettier, generated-file, release-check, pitfall]
---

# book 索引是生成物，prettier 别碰

- **Scenario**: 合并后收口重刷索引，顺手对 `book/README.md` 跑了 `prettier --write`（想让格式过关）。
- **Why**: README 是 `gen-book-index.mjs` 的生成物，`book:release-check` 用「重新生成 + 比对」判新鲜度；prettier 重排生成行后与生成器输出不一致 → 判「索引过期」，发版检查失败。
- **怎么用**: 索引收口只做两步——`npm run book:index` + 直接提交生成形态；prettier 只用于手写文档（plan/issue/learn 等）。生成器输出的排版不理想也改生成器，不改产物。
