/* eslint-disable */
/**
 * electron-builder afterPack 钩子：给 .app 签名。
 * 用项目自签证书（专用钥匙串 msd-sign.keychain 里的 multi-session-device），
 * 签名身份稳定——重建升级后 macOS 权限授权（摄像头等 TCC）不丢失。
 * 钥匙串密码存在本地 600 权限文件（不入仓库），签名前先解锁；
 * 证书不存在或签名失败时退回 ad-hoc 匿名签名，保证本地构建永远可用。
 * 背景：无证书时 electron-builder 直接跳过签名，产物缺 _CodeSignature，
 * macOS 视为损坏的包——启动闪退、启动台不收录。
 */
const { execSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { homedir } = require('node:os')
const path = require('node:path')

const IDENTITY = 'multi-session-device'
const KEYCHAIN = path.join(homedir(), 'Library/Keychains/msd-sign.keychain')
const KEYCHAIN_PASS_FILE = path.join(homedir(), 'Library/Keychains/msd-sign.pass')

const sh = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )

  // 专用钥匙串重启/休眠后会自动上锁，先解锁再找身份
  if (existsSync(KEYCHAIN) && existsSync(KEYCHAIN_PASS_FILE)) {
    try {
      sh(`security unlock-keychain -p "$(cat '${KEYCHAIN_PASS_FILE}')" '${KEYCHAIN}'`)
    } catch {}
  }

  const hasCert = (() => {
    try {
      return sh('security find-identity -p codesigning').toString().includes(IDENTITY)
    } catch {
      return false
    }
  })()
  if (!hasCert) {
    console.warn(`[adhoc-sign] 未找到项目证书 ${IDENTITY}，退回 ad-hoc 匿名签名`)
  }
  try {
    execSync(`codesign --force --deep --sign ${hasCert ? `"${IDENTITY}"` : '-'} "${appPath}"`, {
      stdio: 'inherit'
    })
  } catch (error) {
    if (!hasCert) throw error
    console.warn('[adhoc-sign] 项目证书签名失败，退回 ad-hoc。', error.message)
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
  }
}
