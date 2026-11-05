/* eslint-disable */
/**
 * electron-builder afterPack 钩子：给 .app 做无需证书的 ad-hoc 匿名签名。
 * 当前暂停项目证书签名，不访问本机钥匙串或密码文件。
 * 保留签名结构，避免本地构建的包因缺失签名资源而无法正常运行。
 * 匿名签名不保证升级后保留摄像头等 macOS 权限授权。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit'
  })
}
