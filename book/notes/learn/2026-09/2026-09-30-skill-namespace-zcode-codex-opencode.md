---
description: 同一套 SKILL.md 要在 ZCode/Codex/OpenCode 三家统一前缀命名：ZCode 想要冒号得走插件（本项目已弃），三家实际统一用 .agents/skills 的连字符前缀副本
tags: [skills, zcode, codex, opencode, plugin, namespace, skill-install]
---
# 三家 agent 工具的 skill 命名空间机制不同，`plugin:skill` 冒号命名只有 ZCode 插件能做到

- **Scenario**: 想把同一组 SKILL.md 装进 ZCode、Codex、OpenCode，并让它们带统一前缀（如 `bocode:`）时。
- **Why**: ZCode 的冒号命名空间来自**插件**机制（`.zcode-plugin/plugin.json` + `skills/`，经插件市场安装后显示为 `bocode:boscope`）；普通 `.zcode/skills/` 平铺目录的技能名就是目录名。Codex（2026 文档）仓库级扫描的是 `.agents/skills/`，不是 `.codex/skills/`；OpenCode 扫 `.opencode/skills/` 和 `.agents/skills/`。两家都遵循 agent skills 标准：名字只允许小写字母数字加单个连字符（`^[a-z0-9]+(-[a-z0-9]+)*$`），**冒号不合法**，且 OpenCode 强制 frontmatter `name` 必须等于所在目录名。
- **How to apply**: 版本化源放 `skills-zh/`（工具目录都被 gitignore，是安装位不是源）。本项目最终决定：三家统一用 `.agents/skills/` 的 `bocode-` 前缀副本，**不装插件**（插件路线已评估并放弃，机制留档在 Why 里；`cp` 后把 frontmatter `name` 和正文交叉引用一起加前缀，软链不行——name 必须等于目录名）。OpenCode 别把同名 skill 同时放进 `.opencode/skills/` 和 `.agents/skills/`，它要求各位置名字唯一。
