import type { DeviceFormFactor, ImageEntry } from '@shared/types'

/** 向导两页共享的展示工具（产品中文；数据语义见 shared/types 与 compatibility） */

export const FORM_FACTOR_LABELS: Record<DeviceFormFactor, string> = {
  phone: '手机',
  tablet: '平板',
  wear: 'Wear OS',
  desktop: '桌面',
  tv: '电视',
  automotive: '车载',
  unknown: '其他'
}

export const SERVICE_LABELS: Record<string, string> = {
  google_play: 'Google Play',
  google_apis: 'Google APIs',
  aosp: 'AOSP',
  wear: 'Wear OS',
  tv: 'Android TV',
  automotive: 'Automotive'
}

/** API 显示值：结构化版本回显（36 / 36.1），解析不了用平台段原文 */
export const apiDisplay = (entry: Pick<ImageEntry, 'api'>): string => {
  const { major, minor, platformSegment } = entry.api
  if (major === null) return platformSegment
  return minor !== null ? `${major}.${minor}` : `${major}`
}

/** 服务 → 展示名（多服务取第一个主服务） */
export const serviceLabel = (entry: Pick<ImageEntry, 'services'>): string =>
  SERVICE_LABELS[entry.services[0] ?? ''] ?? entry.services[0] ?? '—'

export const serviceLabels = (entry: Pick<ImageEntry, 'services'>): string[] =>
  entry.services.map((service) => SERVICE_LABELS[service] ?? service)

export const formatSize = (bytes: number | null): string =>
  bytes === null ? '大小未知' : `${(bytes / 1024 ** 3).toFixed(1)} GB`

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** 画像 API 范围列显示（"33+" / "29–33" / "—"） */
export const apiRangeDisplay = (profile: {
  apiMin: number | null
  apiMax: number | null
}): string => {
  const { apiMin, apiMax } = profile
  if (apiMin === null) return '—'
  if (apiMax === null) return `${apiMin}+`
  return `${apiMin}–${apiMax}`
}

/** 推荐视图：兼容候选里最近 5 个正式 major（extension/Preview 不计入窗口） */
export const recommendedWindow = (images: ImageEntry[]): Set<number> => {
  const majors = [
    ...new Set(
      images
        .filter(
          (image) =>
            image.api.major !== null &&
            image.api.codename === null &&
            image.api.extensionLevel === null
        )
        .map((image) => image.api.major as number)
    )
  ].sort((a, b) => b - a)
  return new Set(majors.slice(0, 5))
}
