// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  assessImageCompatibility,
  hostImageAbi,
  profileHasSupportedImage
} from '@shared/compatibility'

/** 画像/镜像的最小可判定形状（assessImageCompatibility 的 Pick 签名） */
type ProfileArg = Parameters<typeof assessImageCompatibility>[0]
type ImageArg = Parameters<typeof assessImageCompatibility>[1]

const profile = (overrides: Partial<ProfileArg> = {}): ProfileArg => ({
  formFactor: 'phone',
  apiMin: null,
  apiMax: null,
  creatable: true,
  ...overrides
})

const image = (overrides: Partial<ImageArg> = {}): ImageArg => ({
  abi: 'arm64-v8a',
  services: ['google_play'],
  api: {
    platformSegment: 'android-36',
    major: 36,
    minor: null,
    codename: null,
    extensionLevel: null,
    baseExtension: null
  },
  ...overrides
})

describe('assessImageCompatibility', () => {
  it('匹配的 arm64 正式镜像 → supported（36.1 小版本附说明）', () => {
    expect(assessImageCompatibility(profile(), image())).toEqual({
      status: 'supported',
      reasons: []
    })
    const minor = assessImageCompatibility(
      profile(),
      image({
        api: {
          platformSegment: 'android-36.1',
          major: 36,
          minor: 1,
          codename: null,
          extensionLevel: 20,
          baseExtension: null
        }
      })
    )
    expect(minor.status).toBe('supported')
    expect(minor.reasons[0]).toContain('36.1')
  })

  it('x86_64 跨架构 → unsupported（macOS Apple Silicon 本期边界）', () => {
    const verdict = assessImageCompatibility(profile(), image({ abi: 'x86_64' }))
    expect(verdict.status).toBe('unsupported')
    expect(verdict.reasons[0]).toContain('x86_64')
  })

  it('canary/Preview → unsupported（开放策略保守，守卫独立于展示开关）', () => {
    const verdict = assessImageCompatibility(
      profile(),
      image({
        api: {
          platformSegment: 'android-canary-20260909',
          major: 37,
          minor: 2,
          codename: 'CANARY',
          extensionLevel: 24,
          baseExtension: null
        }
      })
    )
    expect(verdict.status).toBe('unsupported')
    expect(verdict.reasons[0]).toContain('Preview')
  })

  it('形态与服务不匹配：wear 画像配 phone 镜像 → unsupported', () => {
    const verdict = assessImageCompatibility(
      profile({ formFactor: 'wear' }),
      image({ services: ['google_play'] })
    )
    expect(verdict.status).toBe('unsupported')
    expect(verdict.reasons[0]).toContain('不匹配')
  })

  it('wear 画像配 wear 镜像 → supported；automotive 画像配含 automotive 服务的镜像 → supported', () => {
    expect(
      assessImageCompatibility(profile({ formFactor: 'wear' }), image({ services: ['wear'] }))
        .status
    ).toBe('supported')
    expect(
      assessImageCompatibility(
        profile({ formFactor: 'automotive' }),
        image({ services: ['automotive', 'google_apis'] })
      ).status
    ).toBe('supported')
  })

  it('API 范围：低于画像 apiMin / 高于 apiMax → unsupported；无法解析 → unknown', () => {
    expect(
      assessImageCompatibility(
        profile({ apiMin: 33 }),
        image({
          api: {
            platformSegment: 'android-31',
            major: 31,
            minor: null,
            codename: null,
            extensionLevel: null,
            baseExtension: null
          }
        })
      ).status
    ).toBe('unsupported')
    expect(assessImageCompatibility(profile({ apiMax: 30 }), image()).status).toBe('unsupported')
    expect(
      assessImageCompatibility(
        profile({ apiMin: 33 }),
        image({
          api: {
            platformSegment: 'android-weird',
            major: null,
            minor: null,
            codename: null,
            extensionLevel: null,
            baseExtension: null
          }
        })
      ).status
    ).toBe('unknown')
  })

  it('desktop 无官方镜像源 → unknown；unknown 形态 → unknown；不可创建画像 → unsupported', () => {
    expect(assessImageCompatibility(profile({ formFactor: 'desktop' }), image()).status).toBe(
      'unknown'
    )
    expect(assessImageCompatibility(profile({ formFactor: 'unknown' }), image()).status).toBe(
      'unknown'
    )
    expect(assessImageCompatibility(profile({ creatable: false }), image()).status).toBe(
      'unsupported'
    )
  })
})

describe('profileHasSupportedImage（共享态画像可用性，plan 2026-10-12）', () => {
  const images = (...overs: Partial<ImageArg>[]): Array<ImageArg & { installed: boolean }> =>
    overs.map((entry) => ({ ...image(entry), installed: true }))

  it('已装 ∧ 匹配镜像 → true；未装的同镜像不算', () => {
    expect(profileHasSupportedImage(profile(), [{ ...image(), installed: true }])).toBe(true)
    expect(profileHasSupportedImage(profile(), [{ ...image(), installed: false }])).toBe(false)
  })

  it('形态不匹配（手机画像 × wear 镜像）→ false；wear 画像 × wear 镜像 → true', () => {
    const wearImage = image({ services: ['wear'] })
    expect(profileHasSupportedImage(profile(), images({ services: ['wear'] }))).toBe(false)
    expect(
      profileHasSupportedImage(profile({ formFactor: 'wear' }), [{ ...wearImage, installed: true }])
    ).toBe(true)
  })

  it('已装 x86_64 / Preview / API 超画像范围 → 均不可用（沿用 assess 全维度）', () => {
    expect(profileHasSupportedImage(profile(), images({ abi: 'x86_64' }))).toBe(false)
    expect(
      profileHasSupportedImage(
        profile(),
        images({
          api: {
            platformSegment: 'android-36',
            major: 36,
            minor: null,
            codename: 'Baklava',
            extensionLevel: null,
            baseExtension: null
          }
        })
      )
    ).toBe(false)
    expect(profileHasSupportedImage(profile({ apiMax: 30 }), images())).toBe(false)
  })

  it('镜像数组为空 → false（共享根无镜像时空态分支）', () => {
    expect(profileHasSupportedImage(profile(), [])).toBe(false)
  })
})

describe('宿主 ABI 单源（plan 2026-10-22-windows-emulator-env）', () => {
  it('hostImageAbi：win32 → x86_64；darwin/linux → arm64-v8a', () => {
    expect(hostImageAbi('win32')).toBe('x86_64')
    expect(hostImageAbi('darwin')).toBe('arm64-v8a')
    expect(hostImageAbi('linux')).toBe('arm64-v8a')
  })

  it('hostAbi=x86_64（win32）：x86_64 镜像 supported，arm64 镜像 unsupported 且理由含新文案', () => {
    const verdict = assessImageCompatibility(profile(), image({ abi: 'x86_64' }), 'zh-CN', 'x86_64')
    expect(verdict.status).toBe('supported')
    const cross = assessImageCompatibility(profile(), image(), 'zh-CN', 'x86_64')
    expect(cross.status).toBe('unsupported')
    expect(cross.reasons[0]).toContain('arm64-v8a')
    expect(cross.reasons[0]).toContain('x86_64')
  })

  it('缺省 hostAbi（mac 现状回归）：arm64 supported、x86_64 unsupported', () => {
    expect(assessImageCompatibility(profile(), image()).status).toBe('supported')
    expect(assessImageCompatibility(profile(), image({ abi: 'x86_64' })).status).toBe('unsupported')
  })

  it('profileHasSupportedImage 按宿主 ABI 收窄：win32 下只有 x86_64 已装可用', () => {
    const installed = (abi: string): Parameters<typeof profileHasSupportedImage>[1][number] => ({
      ...image({ abi }),
      installed: true
    })
    const x86 = installed('x86_64')
    const arm = installed('arm64-v8a')
    expect(profileHasSupportedImage(profile(), [arm, x86], 'zh-CN', 'x86_64')).toBe(true)
    expect(profileHasSupportedImage(profile(), [arm], 'zh-CN', 'x86_64')).toBe(false)
    expect(profileHasSupportedImage(profile(), [arm])).toBe(true)
  })
})
