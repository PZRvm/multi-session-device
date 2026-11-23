/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder 配置由 Node 直接加载 */
const { readFileSync } = require('node:fs')
const { load } = require('js-yaml')
const { readVersionReleaseNotes } = require('./release-notes.cjs')
const config = load(readFileSync('electron-builder.yml', 'utf8'))
const test = process.env.MSD_UPDATE_TEST_BUILD === 'true'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
if (test) {
  const origin = process.env.MSD_UPDATE_TEST_ORIGIN
  const testVersion = process.env.MSD_UPDATE_TEST_VERSION
  if (
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin ?? '') ||
    !/^90\.0\.[1-9]\d*$/.test(testVersion ?? '')
  )
    throw new Error('隔离测试包需要 loopback 更新源和 90.0.N 测试版本')
  config.appId = 'com.foreunit.multi-session-device.update-test'
  config.productName = 'Multi Session Device Update Test'
  config.win.executableName = 'multi-session-device-update-test'
  config.extraMetadata = { name: 'multi-session-device-update-test', version: testVersion }
  config.publish = { provider: 'generic', url: origin }
  config.releaseInfo = { releaseNotes: 'Isolated in-app update verification' }
} else {
  config.publish = {
    provider: 'github',
    owner: 'PZRvm',
    repo: 'multi-session-device',
    releaseType: 'release'
  }
  config.releaseInfo = { releaseNotes: readVersionReleaseNotes(version) }
}
config.files = ['package.json', 'out/**', 'resources/**']
config.afterPack = 'scripts/prepare-mac-sparkle.cjs'
const artifactName = test ? 'multi-session-device' : '${name}'
config.mac.artifactName = artifactName + '-${version}-mac-${arch}.${ext}'
config.mac.target = ['dmg', 'zip']
config.dmg.artifactName = config.mac.artifactName
config.nsis.artifactName = artifactName + '-${version}-windows-${arch}-setup.${ext}'
module.exports = config
