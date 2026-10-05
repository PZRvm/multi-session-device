import type { DeviceFormFactor, DeviceProfile, ImageEntry } from '@shared/types'

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
  image: Pick<ImageEntry, 'abi' | 'services' | 'api'>
): CompatibilityVerdict => {
  const reasons: string[] = []

  if (image.abi !== 'arm64-v8a') {
    reasons.push(`跨架构镜像（${image.abi}）在 macOS Apple Silicon 本期不支持`)
    return unsupported(...reasons)
  }

  if (image.api.codename !== null) {
    reasons.push(`Preview/canary 镜像（${image.api.codename}），本期不开放创建`)
    return unsupported(...reasons)
  }

  if (!profile.creatable) {
    reasons.push('该画像无法通过 avdmanager 创建（元数据未关联）')
    return unsupported(...reasons)
  }

  const allowed = FORM_FACTOR_SERVICES[profile.formFactor]
  if (allowed === undefined) {
    if (profile.formFactor === 'unknown') {
      reasons.push('画像形态未知，兼容性无法判定')
    } else if (profile.formFactor === 'desktop') {
      reasons.push('桌面形态暂无官方系统镜像源，待官方发布后开放')
    }
    return unknown(...reasons)
  }

  const matched = image.services.find((service) => allowed.has(service))
  if (matched === undefined) {
    const need = [...allowed].join(' / ')
    const has = image.services.length > 0 ? image.services.join(' / ') : '无服务标签'
    reasons.push(`镜像服务（${has}）与设备形态不匹配，该形态需要 ${need} 镜像`)
    return unsupported(...reasons)
  }

  const { major, minor } = image.api
  if (profile.apiMin !== null && major !== null) {
    if (major < profile.apiMin) {
      reasons.push(`镜像 API ${major} 低于画像最低要求 API ${profile.apiMin}`)
      return unsupported(...reasons)
    }
  } else if (profile.apiMin !== null && major === null) {
    reasons.push('镜像 API 版本无法解析，未核对画像范围')
  }
  if (profile.apiMax !== null && major !== null && major > profile.apiMax) {
    reasons.push(`镜像 API ${major} 超出画像支持上限 API ${profile.apiMax}`)
    return unsupported(...reasons)
  }
  if (major === null) {
    return unknown(...reasons, '镜像 API 版本无法解析')
  }
  if (minor !== null) {
    reasons.push(`API ${major}.${minor} 小版本镜像，按正式 minor 版本对待`)
  }

  return supported(reasons)
}
