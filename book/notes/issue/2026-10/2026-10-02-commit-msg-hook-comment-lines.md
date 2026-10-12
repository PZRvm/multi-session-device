---
description: commit-msg hook 直接取消息首行，不跳过空行与 # 注释行——模板残留或前导空行会以莫名的结构错误拦下提交
status: resolved
---

> 2026-10-12 核销（fix/issue-audit 批）：.githooks/commit-msg 现取「第一个非空、非 # 注释行」作主题，模板残留不再误拦。
# commit-msg hook 未滤空行与注释行

- **Observed**: 2026-10-02 Phase 5 review 发现：`.githooks/commit-msg` 用 `head -n 1 "$1"` 取主题，不跳过空行和 `#` 开头的注释行。已实测两种退出码 1：消息文件首行是 `# Please enter the commit message…`（编辑器模板残留，`--cleanup=verbatim` 下会保留到 commit-msg 阶段）、消息文件以空行开头——两种都报"整体结构不对"或"需要一个主题行"，报错不指向真实原因。
- **Reproduction**: `printf '# Please enter the commit message\n📦 new: x\n' > /tmp/m && .githooks/commit-msg /tmp/m`——退出码 1；首行换成一个空行同样退出码 1。
- **建议方向**: hook 里先滤掉空行与 `#` 开头的行再取第一个非空行作主题（`grep -v '^\s*\(#\|$\)' | head -n 1` 一类）；或把该逻辑并进校验脚本、hook 保持薄。影响面小（`git commit -m` 与默认 cleanup 下很难触发），仅记录，不顺手修。

## 跟进（2026-10-02）——已修

hook 改为 `grep -Ev '^[[:space:]]*(#|$)' | head -n 1` 取第一个非空、非注释行（-E 保证 BSD/GNU grep 通用，过滤逻辑留在 hook、校验脚本保持只吃单行主题）。验证：两条原复现路径（注释首行、前导空行）均转 0；全注释/空行文件仍以 1 拒绝；正常合法/非法/Merge 跳过三例回归无变化。
