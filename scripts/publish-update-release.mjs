/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node 发布工具 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { validateUpdateAssets } from './update-assets.mjs'

const require = createRequire(import.meta.url)
const { readVersionReleaseNotes } = require('./release-notes.cjs')
const { name, version } = require('../package.json')
const repository = process.env.GITHUB_REPOSITORY
const sha = process.env.RELEASE_SHA
if (
  repository !== 'PZRvm/multi-session-device' ||
  !/^[0-9a-f]{40}$/.test(sha ?? '') ||
  !process.argv[2]
)
  throw new Error('稳定版发布需要目标仓库、合并 SHA 和已验证附件目录')

const directory = resolve(process.argv[2])
const tag = 'v' + version
const notes = readVersionReleaseNotes(version)
const assets = validateUpdateAssets(directory, name, version, notes)
const sumName = 'SHA256SUMS'
const digest = (file) =>
  createHash('sha256')
    .update(readFileSync(join(directory, file)))
    .digest('hex')
writeFileSync(
  join(directory, sumName),
  assets.map((file) => digest(file) + '  ' + file).join('\n') + '\n'
)
const expected = new Map(
  [...assets, sumName].map((file) => [
    file,
    { hash: 'sha256:' + digest(file), size: statSync(join(directory, file)).size }
  ])
)

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' })
gh([
  'release',
  'create',
  tag,
  ...Array.from(expected.keys(), (file) => join(directory, file)),
  '--repo',
  repository,
  '--target',
  sha,
  '--draft',
  '--title',
  tag,
  '--notes-file',
  join(directory, 'release-notes-' + tag + '.md')
])
const api = 'repos/' + repository + '/releases'
const release = JSON.parse(gh(['api', api + '/tags/' + tag]))
if (
  !release.draft ||
  release.prerelease ||
  release.tag_name !== tag ||
  release.target_commitish !== sha ||
  release.body !== notes
)
  throw new Error('草稿标签、状态或说明与本地记录不一致')
if (release.assets.length !== expected.size) throw new Error('草稿附件数量不符')
for (const asset of release.assets) {
  const local = expected.get(asset.name)
  if (
    !local ||
    asset.state !== 'uploaded' ||
    asset.size !== local.size ||
    asset.digest !== local.hash
  )
    throw new Error('远程附件状态、大小或摘要不匹配：' + asset.name)
  expected.delete(asset.name)
}
if (expected.size) throw new Error('远程草稿资产未传齐')
gh([
  'api',
  '--method',
  'PATCH',
  api + '/' + release.id,
  '-F',
  'draft=false',
  '-F',
  'prerelease=false',
  '-f',
  'make_latest=true'
])
const latest = JSON.parse(gh(['api', api + '/latest']))
if (latest.id !== release.id) throw new Error('最新稳定版指向其他版本')
