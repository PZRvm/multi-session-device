#!/usr/bin/env node
/**
 * Clean Commit 主题校验——契约见 book/guidelines/git-workflow.md。
 *
 * 用法：   node scripts/check-commit-message.mjs "<subject>"
 *          （.githooks/commit-msg 与 .github/workflows/git-policy.yml 都调它）
 *
 * 校验格式、emoji↔type 配对、type/scope 小写、破坏性标记 `!` 的适用范围、
 * 句号结尾和长度；现在时与否留到 review 人工判断。合并与回退提交是 git
 * 自动生成的主题，跳过不校验——规则只管新提交，既有历史永不重写。
 * 零依赖，Node 自带模块即可运行。
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 零依赖 .mjs 脚本要能被 node 直接运行，写不了 TS 返回类型标注 */
const TYPES = {
  '📦': 'new',
  '🔧': 'update',
  '🗑': 'remove',
  '🔒': 'security',
  '⚙': 'setup',
  '☕': 'chore',
  '🧪': 'test',
  '📖': 'docs',
  '🚀': 'release'
}
// 破坏性标记 `!` 只允许这四个 type 用
const BREAKABLE = new Set(['new', 'update', 'remove', 'security'])
const MAX_DESC = 72
const MAX_SCOPE = 24

const fail = (problems, subject) => {
  console.error(`✗ 主题不符合 Clean Commit：${subject}`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('  合法形式：')
  console.error('    <emoji> <type>: <description>')
  console.error('    <emoji> <type> (<scope>): <description>')
  console.error('    （`!` 紧跟 type 标破坏性，只用于 new/update/remove/security）')
  console.error(
    '  type 对照：📦 new 🔧 update 🗑️ remove 🔒 security ⚙️ setup ☕ chore 🧪 test 📖 docs 🚀 release'
  )
  process.exit(1)
}

const subject = (process.argv[2] ?? '').split('\n')[0].trim()
if (!subject) {
  console.error('用法：node scripts/check-commit-message.mjs "<subject>"——需要一个主题行')
  process.exit(1)
}

if (/^Merge( |$)/.test(subject) || /^Revert "/.test(subject)) {
  console.log(`跳过（git 自动生成的合并/回退主题，不校验）：${subject}`)
  process.exit(0)
}

// 结构：<emoji> <type>[!][ (<scope>)]: <description>
const m = subject.match(/^(\S+) (\S+?)(!)?(?: \(([^)]+)\))?: (.+)$/)
if (!m) fail([`整体结构不对：${subject}`], subject)
const [, rawEmoji, type, bang, scope, desc] = m

const problems = []

// emoji 统一去掉 VS16（\uFE0F）再比对，垃圾桶/齿轮等带变体选择符的不会误报
const emoji = rawEmoji.replace(/\uFE0F/g, '')
if (!TYPES[emoji]) problems.push(`emoji「${rawEmoji}」不在 Clean Commit 对照表里`)
else if (TYPES[emoji] !== type)
  problems.push(`emoji 与 type 不配对：${rawEmoji} 应配 ${TYPES[emoji]}，实际是 ${type}`)

if (type !== type.toLowerCase()) problems.push(`type 必须小写：${type}`)

if (bang && !BREAKABLE.has(type))
  problems.push(`破坏性标记 ! 只用于 new/update/remove/security，不能用于 ${type}`)

if (scope !== undefined) {
  if (!scope) problems.push('scope 不能是空括号')
  else {
    if (/[A-Z]/.test(scope)) problems.push(`scope 必须小写：${scope}`)
    if (/\s/.test(scope)) problems.push(`scope 不能含空白：${scope}`)
    if ([...scope].length > MAX_SCOPE)
      problems.push(`scope 要短（≤${MAX_SCOPE} 字符）：${scope} 有 ${[...scope].length} 个`)
  }
}

if (!desc.trim()) problems.push('description 不能为空')
else {
  if (/[.。]$/.test(desc.trim())) problems.push(`description 不以句号结尾：${desc}`)
  if ([...desc].length > MAX_DESC)
    problems.push(`description ≤${MAX_DESC} 字符：当前 ${[...desc].length} 个`)
}

if (problems.length > 0) fail(problems, subject)
console.log(`✓ ${subject}`)
