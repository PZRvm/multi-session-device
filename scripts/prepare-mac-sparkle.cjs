/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- electron-builder 钩子 */
const { execFileSync } = require('node:child_process')
const { cpSync, copyFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const sign = require('./adhoc-sign-mac.cjs').default

exports.default = async function prepareMacSparkle(context) {
  if (context.electronPlatformName !== 'darwin') return
  const config = context.packager.config
  if (context.arch !== 3) throw new Error('首期 Sparkle 更新仅支持 Mac arm64')
  const test = config.appId === 'com.foreunit.multi-session-device.update-test'
  const key = process.env.SPARKLE_PUBLIC_ED_KEY
  const origin = process.env.MSD_UPDATE_TEST_ORIGIN
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key ?? '')) throw new Error('缺少有效的 Sparkle 公钥')
  if (test && !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(origin ?? ''))
    throw new Error('隔离测试源必须为指定端口的 loopback 地址')

  const { buildSparkle, sdkRoot, sparklePin } = await import('./build-sparkle.mjs')
  const bridge = buildSparkle('arm64')
  const contents = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents'
  )
  const resources = join(contents, 'Resources', 'sparkle')
  mkdirSync(resources, { recursive: true })
  cpSync(join(sdkRoot, 'Sparkle.framework'), join(contents, 'Frameworks/Sparkle.framework'), {
    recursive: true,
    verbatimSymlinks: true
  })
  copyFileSync(bridge, join(resources, 'bridge.node'))
  copyFileSync(join(sdkRoot, 'LICENSE'), join(resources, 'LICENSE'))

  const info = join(contents, 'Info.plist')
  const set = (name, type, value) => {
    execFileSync('/usr/bin/plutil', ['-replace', name, `-${type}`, value, info])
  }
  const feed = test
    ? `${origin}/appcast-arm64.xml`
    : 'https://github.com/PZRvm/multi-session-device/releases/latest/download/appcast-arm64.xml'
  set('LSMinimumSystemVersion', 'string', sparklePin.deploymentTarget)
  set('SUPublicEDKey', 'string', key)
  set('SUFeedURL', 'string', feed)
  for (const flag of [
    'SUEnableAutomaticChecks',
    'SUAutomaticallyUpdate',
    'SUAllowsAutomaticUpdates'
  ])
    set(flag, 'bool', 'false')
  if (test) {
    set('MSDSparkleTestBuild', 'bool', 'true')
    try {
      execFileSync(
        '/usr/bin/plutil',
        ['-extract', 'NSAppTransportSecurity', 'xml1', '-o', '-', info],
        { stdio: 'ignore' }
      )
    } catch {
      execFileSync('/usr/bin/plutil', [
        '-insert',
        'NSAppTransportSecurity',
        '-xml',
        '<dict/>',
        info
      ])
    }
    set('NSAppTransportSecurity.NSAllowsLocalNetworking', 'bool', 'true')
  }
  await sign(context)
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(contents, '..')])
}
