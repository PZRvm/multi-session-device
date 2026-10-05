// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assessImageCompatibility } from '@shared/compatibility'

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
