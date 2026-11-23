/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- electron-builder 配置由 Node 直接加载 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

function readVersionReleaseNotes(version, root = process.cwd()) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('更新日志需要稳定版本号')
  const file = join(root, '.github', 'release-notes', `v${version}.md`)
  const notes = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim()
  if (!notes || notes.length > 12000)
    throw new Error(`版本 ${version} 的更新日志必须为 1—12000 字符`)
  return notes
}

module.exports = { readVersionReleaseNotes }
