import type { DeviceFormFactor, DeviceProfile, ImageEntry } from './types'
import { ERRORS_COPY, format, type SettingsLocale } from './i18n'

/**
 * 镜像兼容性判定（plan 设计 2）：supported | unsupported | unknown + 中文原因。
 * 判定维度：ABI（本期仅 arm64）、形态与镜像服务匹配、画像 API 范围、
 * Preview 开放策略。不支持项的展示开关无法改变创建资格——守卫独立于此模块。
 */

export interface CompatibilityVerdict {
  status: 'supported' | 'unsupported' | 'unknown'
  reasons: string[]
}

const supported = (reasons: string[] = []): CompatibilityVerdict => ({
  status: 'supported',
  reasons
})

const unsupported = (...reasons: string[]): CompatibilityVerdict => ({
  status: 'unsupported',
  reasons
})

const unknown = (...reasons: string[]): CompatibilityVerdict => ({
  status: 'unknown',
  reasons
})

/** 形态 ↔ 镜像服务匹配矩阵（desktop 本期无官方镜像源；unknown 形态不猜） */
const FORM_FACTOR_SERVICES: Partial<Record<DeviceFormFactor, Set<string>>> = {
  phone: new Set(['aosp', 'google_apis', 'google_play']),
  tablet: new Set(['aosp', 'google_apis', 'google_play']),
  wear: new Set(['wear']),
  tv: new Set(['tv']),
  automotive: new Set(['automotive'])
}

/**
 * 画像 × 镜像兼容性。emulator 最低版本依赖由安装核验侧（source.properties
 * 的 Pkg.Dependencies）在创建时核对，不在此重复。
 */
export const assessImageCompatibility = (
  profile: Pick<DeviceProfile, 'formFactor' | 'apiMin' | 'apiMax' | 'creatable'>,
  image: Pick<ImageEntry, 'abi' | 'services' | 'api'>,
  locale: SettingsLocale = 'zh-CN'
): CompatibilityVerdict => {
  const reasons: string[] = []
  const m = ERRORS_COPY[locale]

  if (image.abi !== 'arm64-v8a') {
    reasons.push(format(m.compatCrossArch, { abi: image.abi }))
    return unsupported(...reasons)
  }

  if (image.api.codename !== null) {
    reasons.push(format(m.compatPreview, { codename: image.api.codename }))
    return unsupported(...reasons)
  }

  if (!profile.creatable) {
    reasons.push(m.compatNotCreatable)
    return unsupported(...reasons)
  }

  const allowed = FORM_FACTOR_SERVICES[profile.formFactor]
  if (allowed === undefined) {
    if (profile.formFactor === 'unknown') {
      reasons.push(m.compatUnknownForm)
    } else if (profile.formFactor === 'desktop') {
      reasons.push(m.compatDesktopForm)
    }
    return unknown(...reasons)
  }

  const matched = image.services.find((service) => allowed.has(service))
  if (matched === undefined) {
    const need = [...allowed].join(' / ')
    const has = image.services.length > 0 ? image.services.join(' / ') : m.compatNoServiceTag
    reasons.push(format(m.compatServiceMismatch, { has, need }))
    return unsupported(...reasons)
  }

  const { major, minor } = image.api
  if (profile.apiMin !== null && major !== null) {
    if (major < profile.apiMin) {
      reasons.push(format(m.compatApiBelowMin, { major, min: profile.apiMin }))
      return unsupported(...reasons)
    }
  } else if (profile.apiMin !== null && major === null) {
    reasons.push(m.compatApiUnparsed)
  }
  if (profile.apiMax !== null && major !== null && major > profile.apiMax) {
    reasons.push(format(m.compatApiAboveMax, { major, max: profile.apiMax }))
    return unsupported(...reasons)
  }
  if (major === null) {
    return unknown(...reasons, m.compatApiUnparsedShort)
  }
  if (minor !== null) {
    reasons.push(format(m.compatMinorNote, { major, minor }))
  }

  return supported(reasons)
}
