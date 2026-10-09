#!/usr/bin/env node
/**
 * 扫描 book/ 下所有 Markdown，重新生成 book/README.md——全书总索引。
 *
 * 用法：   npm run book:index              # 重新生成
 *          npm run book:index -- --check   # 只校验不写盘，book:release-check 内部用它
 *
 * 约定：
 *   1. 每篇文档开头带 frontmatter `description`：一行说人话的内容摘要。
 *      缺失 → 警告，退出码 1。
 *   2. 内部链接必须能解析。相对链接断了 → 警告，退出码 1——book 同时是
 *      Obsidian vault，死链就是构建事故。
 *
 * 引入自 BoCode（github.com/Focus695/BoCode）code/tools/gen-book-index.mjs，
 * 按本仓库适配：book/ 在仓库根（本仓库没有 code/ 目录）；目录用途表换成
 * stage/、think-report/ 等本仓库实际分类（summary 与 changelogs 未启用，
 * 已移除）；输出与报错文案改中文；新增 --check 模式供发版检查用。
 * 零依赖，Node 自带模块即可运行。
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 零依赖 .mjs 脚本要能被 node 直接运行，写不了 TS 返回类型标注 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(TOOLS_DIR, '..')
const BOOK_ROOT = join(ROOT, 'book')
const OUTPUT = join(BOOK_ROOT, 'README.md')

function projectName() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    if (pkg.name) return pkg.name
  } catch {
    // 没有 package.json 或没有 name——落到默认值
  }
  return 'this project'
}

const NAME = projectName()

// 新增 book 目录时在这里补一行用途；没登记的目录在索引里会显示空白用途
const DIR_PURPOSE = {
  guidelines: '规则书：人和 agent 永远怎么工作，长期稳定',
  stage:
    '开发阶段：项目接下来走哪、每步做完没；人定阶段和步骤，勾选附一行结果（替代原 summary 机制）',
  notes: '过程笔记：开发中发生了什么，只增不改',
  'notes/learn': '经验与教训，写码前后按 tags 检索，按月份归档',
  'notes/task': '任务跟踪与拆解的检查清单',
  'notes/issue': '发现但不修的问题——只记录，修复是另一份工作',
  'notes/think-report': '功能可行性调研：配置能力、候选方案、落地路径与待确认边界',
  'think-report': '可行性调研报告：立项前的调研结论（本仓库自定义分类）',
  docs: '参考快照：系统现在长什么样、当时为什么这么定',
  'docs/api': '接口契约：对外/模块间接口长什么样',
  'docs/architecture': '架构快照：模块划分与数据流的当前状态',
  'docs/decisions': 'ADR 决策记录：一条记一个选择及其理由',
  'docs/poc': 'PoC 实测报告：闸门验收的原始数据、方法与结论',
  plans: '施工图：一个功能一篇，Phase 2 设计确认后落盘，agent 照着施工'
}

function purposeForDir(dir) {
  if (DIR_PURPOSE[dir]) return DIR_PURPOSE[dir]
  const parent = Object.keys(DIR_PURPOSE)
    .filter((key) => key && dir.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0]
  return parent ? `归档于 ${parent}/，按月份分组` : ''
}

function walkMd(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkMd(full))
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

function parseDescription(text) {
  if (!text.startsWith('---')) return null
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return null // frontmatter 结束了，没找到
    const m = lines[i].match(/^description:\s*(.+)$/)
    if (m) return m[1].trim()
  }
  return null
}

function collectInternalLinks(text) {
  const out = []
  const re = /(?:\]\(<([^>]+)>\)|\]\(([^)\s]+)\))/g
  let m
  while ((m = re.exec(text))) {
    const target = (m[1] || m[2]).split('#')[0]
    if (target && !/^[a-z]+:/.test(target)) out.push(target) // 跳过 http:、mailto:、obsidian:…
  }
  return out
}

function link(rel) {
  return /[\s()]/.test(rel) ? `<${rel}>` : rel
}

const checkOnly = process.argv.includes('--check')

const files = walkMd(BOOK_ROOT)
  .filter((f) => f !== OUTPUT)
  .sort()

const warnings = []
const brokenLinks = []
const byDir = new Map()

for (const abs of files) {
  const rel = relative(BOOK_ROOT, abs)
  const dir = dirname(rel) === '.' ? '' : dirname(rel)
  const text = readFileSync(abs, 'utf8')
  const desc = parseDescription(text)
  if (!desc) warnings.push(rel)
  for (const target of collectInternalLinks(text)) {
    const resolved = resolve(dirname(abs), target)
    if (!existsSync(resolved)) brokenLinks.push(`${rel} → ${target}`)
  }
  if (!byDir.has(dir)) byDir.set(dir, [])
  byDir.get(dir).push({ name: rel.split('/').pop(), rel, desc: desc ?? '（缺 description）' })
}

const dirKeys = [...byDir.keys()].sort((a, b) => a.localeCompare(b, 'en'))

let out = ''
out += '---\n'
out += 'description: book 总索引——每篇文档的地图。book 有改动后跑 npm run book:index 重新生成\n'
out += '---\n\n'
out += `# book — ${NAME} 总索引\n\n`
out += '> 脚本生成——勿手改。book 有任何改动后跑：`npm run book:index`。\n'
out +=
  '> 每篇新文档必须带 frontmatter `description`（一行说内容不说体裁的摘要）；缺一个构建就以退出码 1 失败。\n\n'
out += '## 怎么用这本 book\n\n'
out +=
  '- **AI agent**：先读本文件拿全书地图，再顺着链接去要去的目录。动笔写 book 文档前，先读 `guidelines/writing-style.md`。\n'
out +=
  '- **人**：按下面的目录表浏览。规则在 `guidelines/`，进度在 `stage/`，施工图在 `plans/`，经验在 `notes/learn/`，决策在 `docs/decisions/`。\n'
out +=
  '- **按时间**：`notes/{learn,issue}/` 按 `YYYY-MM/` 归档——月份只是物理分组，别按功能嵌套更深。变更记录不设 changelog，看 git log。\n'
out +=
  '- **按功能**：在本索引里搜功能名、关键词或 frontmatter 摘要；`notes/learn/` 的条目还能按 `tags` 搜。\n'
out +=
  '- **Obsidian**：把 `book/` 直接当 vault 打开。链接都是普通相对 Markdown；挪了文件就重跑索引。\n\n'
out += '## 目录地图\n\n'
out += '| 目录 | 用途 |\n|------|------|\n'
for (const key of dirKeys) {
  const label = key === '' ? '（根）' : key + '/'
  out += `| \`${label}\` | ${purposeForDir(key)} |\n`
}
out += '\n## 全部文件\n\n'
for (const key of dirKeys) {
  const label = key === '' ? '根' : key + '/'
  out += `### ${label}\n\n`
  for (const f of byDir.get(key)) {
    out += `- [${f.name}](${link(f.rel)}) — ${f.desc}\n`
  }
  out += '\n'
}
out += `<!-- ${files.length} documents -->\n`

const problems = warnings.length > 0 || brokenLinks.length > 0

if (warnings.length > 0) {
  console.error(`缺 frontmatter description 的文件（${warnings.length}）：`)
  for (const w of warnings) console.error(`  - ${w}`)
}
if (brokenLinks.length > 0) {
  console.error(`断掉的内部链接（${brokenLinks.length}）：`)
  for (const l of brokenLinks) console.error(`  - ${l}`)
}

if (checkOnly) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
  if (current !== out) {
    console.error(
      `book/README.md 已过期（与重新生成的索引不一致${files.length ? `，当前收录 ${files.length} 篇` : ''}）。跑 npm run book:index 后重试。`
    )
    process.exit(1)
  }
  if (problems) {
    console.error('除上述问题外索引本身是最新的。修完文件再重跑 npm run book:release-check。')
    process.exit(1)
  }
  console.log(`索引校验通过——${files.length} 篇文档，与 book/README.md 一致，链接全部可解析。`)
  process.exit(0)
}

writeFileSync(OUTPUT, out)

if (problems) {
  console.error(
    `索引已写入 ${OUTPUT}（${files.length} 篇文档），但上述问题会让构建失败。修完重跑。`
  )
  process.exit(1)
}
console.log(`索引已写入 ${OUTPUT}——${files.length} 篇文档，零警告，链接全部可解析。`)
