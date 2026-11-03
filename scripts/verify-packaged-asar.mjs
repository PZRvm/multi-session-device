#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 零依赖 .mjs 脚本要能被 node 直接运行，写不了 TS 返回类型标注 */
/**
 * 打包产物 asar 完整性校验（build:mac 末步自动执行）。
 * 背景：2026-10-13 打包期间项目树仍被并发写入，asar 内容区与索引错位，
 * 主入口 out/main/index.js 混入 e2e/cdp-smoke.mjs 的尾部字节，
 * 应用启动即 SyntaxError 闪退。此类损坏 electron-builder 不报错，
 * 必须在装进 /Applications 之前拦下。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const distAppDir = join(process.cwd(), 'dist', 'mac-arm64')
const archiveArgument = process.argv[2]
const appName = archiveArgument
  ? undefined
  : readdirSync(distAppDir).find((n) => n.endsWith('.app'))
if (!archiveArgument && !appName) {
  console.error(`[verify-asar] 未找到 .app：${distAppDir}`)
  process.exit(1)
}
const asarPath = archiveArgument
  ? resolve(archiveArgument)
  : join(distAppDir, appName, 'Contents', 'Resources', 'app.asar')
const data = readFileSync(asarPath)

// asar 头布局：[4..8)=头 pickle 长度，[12..16)=头 JSON 字节长，内容区从 8+头长 开始
const headerSize = data.readUInt32LE(4)
const jsonLen = data.readUInt32LE(12)
const header = JSON.parse(data.subarray(16, 16 + jsonLen).toString('utf8'))
const base = 8 + headerSize

const files = []
const walk = (node, prefix) => {
  for (const [name, child] of Object.entries(node.files)) {
    const p = prefix ? `${prefix}/${name}` : name
    if (child.files) walk(child, p)
    else if (child.offset != null) files.push([p, base + Number(child.offset), child.size])
  }
}
walk(header, '')

let failed = false
const fail = (msg) => {
  console.error(`[verify-asar] ${msg}`)
  failed = true
}

// 内容区必须覆盖到最后一个文件结尾，否则是写入被截断
const lastEnd = Math.max(...files.map(([, off, size]) => off + size))
if (lastEnd > data.length) {
  fail(`内容区被截断：最后文件需要 ${lastEnd} 字节，归档只有 ${data.length}`)
}

// 主入口必须与仓库 out/main/index.js 逐字节一致（asar 打包是原样拷贝），
// 且能通过语法解析（与 Electron 加载行为等价）
const entry = files.find(([p]) => p === 'out/main/index.js')
if (!entry) {
  fail('asar 里没有 out/main/index.js')
} else {
  const [, off, size] = entry
  const inAsar = data.subarray(off, off + size)
  const inRepo = readFileSync(join(process.cwd(), 'out', 'main', 'index.js'))
  if (!inAsar.equals(inRepo)) {
    fail('asar 内的 out/main/index.js 与仓库产物不一致——打包期间文件被改动（竞态），asar 已错位')
  }
  const tmp = mkdtempSync(join(tmpdir(), 'asar-verify-'))
  try {
    const tmpFile = join(tmp, 'index.js')
    writeFileSync(tmpFile, inAsar)
    try {
      execFileSync(process.execPath, ['--check', tmpFile])
    } catch {
      fail('asar 内的 out/main/index.js 语法解析失败')
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// package.json 必须是合法 JSON（内容区错位时此处通常是别的文件的字节）
const pkg = files.find(([p]) => p === 'package.json')
if (pkg) {
  const [, off, size] = pkg
  try {
    JSON.parse(data.subarray(off, off + size).toString('utf8'))
  } catch {
    fail('asar 内的 package.json 不是合法 JSON——内容区错位')
  }
}

// files 排除项不应再被打进包里
if (files.some(([p]) => p.startsWith('book/') || p.startsWith('e2e/'))) {
  fail('asar 里混入了 book/ 或 e2e/——检查 electron-builder.yml 的 files 排除')
}

if (failed) process.exit(1)
console.log(`[verify-asar] ✓ ${asarPath} 完整（${files.length} 个文件，主入口与仓库产物一致）`)
