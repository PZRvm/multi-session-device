import type { GpuMode, NetworkPreset } from '@shared/types'

/** 设置表单的枚举展示（与 main/emulator/settings.ts 锁定的实测枚举一致） */

export const NETWORK_SPEED_LABELS: Array<[NetworkPreset, string]> = [
  ['gsm', 'GSM（慢）'],
  ['hscsd', 'HSCSD'],
  ['gprs', 'GPRS'],
  ['umts', 'UMTS / 3G'],
  ['edge', 'EDGE'],
  ['hsdpa', 'HSDPA'],
  ['lte', 'LTE / 4G'],
  ['evdo', 'EVDO'],
  ['5g', '5G'],
  ['full', '不限速']
]

export const NETWORK_DELAY_LABELS: Array<[NetworkPreset, string]> = [
  ['gsm', 'GSM（高延迟）'],
  ['hscsd', 'HSCSD'],
  ['gprs', 'GPRS'],
  ['umts', 'UMTS / 3G'],
  ['edge', 'EDGE'],
  ['hsdpa', 'HSDPA（无延迟）'],
  ['lte', 'LTE（无延迟）'],
  ['evdo', 'EVDO（无延迟）'],
  ['5g', '5G（无延迟）'],
  ['none', '无延迟']
]

export const GPU_LABELS: Array<[GpuMode, string]> = [
  ['host', '硬件加速（host）'],
  ['swiftshader_indirect', '软件渲染（SwiftShader）'],
  ['angle_indirect', 'ANGLE（兼容层）'],
  ['guest', '客户机渲染（guest）']
]
