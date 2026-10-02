#!/usr/bin/env node
/**
 * 发版卫生检查——dev → main 之前跑：npm run book:release-check。
 *
 * 上游原版（BoCode code/tools/check-template-clean.mjs）守护的是"模板仓库
 * 发出去必须干净"——guarded 目录里只许有 README。本仓库不是模板，book/ 本该
 * 堆满真实的 learn/issue/plans 记录，所以检查语义按现实改写成两件事：
 *   1. git 树里不许有操作系统垃圾文件（.DS_Store、Thumbs.db、desktop.ini）——
 *      book 是人和 agent 共读的知识库，垃圾进树就是污染。
 *   2. book/README.md 必须与重新生成的索引一致（gen-book-index.mjs --check）——
 *      改了 book 忘跑 book:index，索引就在撒谎。
 * 有任何违规：打印清单，退出码 1。零依赖，需要 git（只读，不改任何东西）。
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GEN = join(ROOT, 'scripts', 'gen-book-index.mjs')
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
if (tracked.error || tracked.status !== 0) {
  console.error('book:release-check 需要 git（git ls-files）——请在仓库内运行。')
  process.exit(1)
}
const junk = tracked.stdout.split('\0').filter((f) => f && JUNK.has(f.split('/').pop()))

if (junk.length > 0) {
  console.error(`git 树里有垃圾文件（${junk.length}）：`)
  for (const f of junk) console.error(`  - ${f}`)
  console.error('处理：git rm --cached <文件>，并确认 .gitignore 覆盖它。')
  process.exit(1)
}

const index = spawnSync(process.execPath, [GEN, '--check'], { cwd: ROOT, stdio: 'inherit' })
if (index.status !== 0) {
  console.error('book 索引检查未过（见上）。修完后重跑 npm run book:release-check。')
  process.exit(index.status ?? 1)
}

console.log('book 干净：git 树无垃圾文件，索引与 book 内容一致。可以发版。')
