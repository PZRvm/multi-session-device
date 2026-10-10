import type { GpuMode, NetworkPreset } from '@shared/types'
import type { WizardCopy } from '@shared/i18n'

/** 设置表单的枚举展示（与 main/emulator/settings.ts 锁定的实测枚举一致）。
 *  文案经 wizard 域字典取词——调用方传当前语言的 WizardCopy */

export const networkSpeedLabels = (copy: WizardCopy): Array<[NetworkPreset, string]> => [
  ['gsm', copy.netSpeedGsm],
  ['hscsd', copy.netHscsd],
  ['gprs', copy.netGprs],
  ['umts', copy.netSpeedUmts],
  ['edge', copy.netEdge],
  ['hsdpa', copy.netHsdpa],
  ['lte', copy.netSpeedLte],
  ['evdo', copy.netEvdo],
  ['5g', copy.net5g],
  ['full', copy.netSpeedFull]
]

export const networkDelayLabels = (copy: WizardCopy): Array<[NetworkPreset, string]> => [
  ['gsm', copy.netDelayGsm],
  ['hscsd', copy.netHscsd],
  ['gprs', copy.netGprs],
  ['umts', copy.netDelayUmts],
  ['edge', copy.netDelayEdge],
  ['hsdpa', copy.netDelayHsdpa],
  ['lte', copy.netDelayLte],
  ['evdo', copy.netDelayEvdo],
  ['5g', copy.netDelay5g],
  ['none', copy.netDelayNone]
]

export const gpuLabels = (copy: WizardCopy): Array<[GpuMode, string]> => [
  ['host', copy.gpuHost],
  ['swiftshader_indirect', copy.gpuSwiftShader],
  ['angle_indirect', copy.gpuAngle],
  ['guest', copy.gpuGuest]
]
