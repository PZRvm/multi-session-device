---
description: 本机 perl -pi 原地替换对以全角标点结尾的词会静默漏替换，管道 -pe 或显式 lookaround 才可靠
tags: [perl, inplace-edit, cjk, regex, word-boundary, silent-fail, pitfall]
---

# 本机（macOS, LC_CTYPE=UTF-8）`perl -pi` 配 `\b` 处理中文文本会静默漏替换

- **Scenario**: 用 `perl -pi -E 's/\b词\b/替换/g'` 批量改含中文的 markdown/文档，且目标词后面紧跟全角标点（`（` `，` `。` 等）时。
- **Why**: 实测同一份文件、同一条正则：`perl -pe`（管道）对所有行替换正确；`perl -pi`（原地）唯独漏掉"词后紧跟全角字符"的行（`\b` 在 `e` 与全角 `（` 的字节之间判定失败），其余行正常——故障是静默的，极易漏检。推测与 `-i` 模式下的 locale/编码初始化差异有关，未深挖。
- **How to apply**: ① 批量改中文文档优先用管道重定向（`perl -pe '…' in > out`），别用 `-pi`；② 正则用显式字符类 lookaround 代替 `\b`（如 `(?<![a-z0-9-])词(?![a-z0-9-])`），顺带获得幂等性（不会给已加前缀的词再叠前缀）；③ 替换后必须校验（grep 残留 + 抽查标题行），不能信"命令没报错就是改对了"。
