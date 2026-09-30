# Skills

四个自包含的 skill 为 AI agent 实现 BoCode 工作流。每个都是标准格式的单个 `SKILL.md`（frontmatter 含 `name` 和 `description`，后面是正文）——没有代码，没有依赖。

| Skill | 干什么 | 触发时机 |
|-------|------|----------|
| `bocode` | 入口 skill（薄码）：结构地图与会话纪律——码前读 book，码后回写 | 在 BoCode 仓库开始会话时；问文档去向或索引机制时 |
| `boscope` | 功能开发 skill（薄界）：Step 0 需求 brief + 六个硬关卡阶段——把界画薄，把关卡立硬 | "实现 / 新增 / 支持 / 改动 X" 而请求很简略时 |
| `book-writeback` | 返写 skill（返写）：回写 book 的模板与质量关卡 | 功能收尾时；"勾个 stage / 写个 learn / issue" |
| `bowrite` | 书写 skill（薄写）：把文档写薄写好——字变少、核心不变、说人话 | 写或改任何文档时；草稿有模板腔、翻译腔、抖机灵的味道时 |

分工：**skill 管"何时做、怎么做"**（给 agent 的可执行行为）；**`book/guidelines/` 管"做什么、为什么"**（给人的参考）。两者互相引用，绝不重复规则。

## 安装

把四个 skill 目录拷进你的 agent 的 skills 目录：

- **ZCode**：`~/.zcode/skills/`（全局）或 `<project>/.zcode/skills/`（单项目）
- **Claude Code**：`~/.claude/skills/` 或 `<project>/.claude/skills/`
- **其他兼容 SKILL.md 的 agent**：你的工具文档里写的 skills 目录

```bash
cp -r skills/bocode skills/boscope skills/book-writeback skills/bowrite <your-skills-dir>/
```

`bowrite` 蒸馏自 [shuorenhua](https://github.com/MrGeDiao/shuorenhua)（MIT，作者 MrGeDiao），加上本项目自己 review 中攒下的模式；做深度中文清理时上游 skill 钻得更深，值得一并安装。
