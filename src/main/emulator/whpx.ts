/**
 * WHPX（Windows 虚拟化）缺失的失败输出匹配（plan 2026-10-22-windows-emulator-env 设计 3）。
 * 只锚高信号整句——`WHPX.*failed` 类宽匹配会被运行期警告日志误伤；真机错误
 * 样本清单归统一集成验证阶段采样回填（见 plan Test plan 真机节）。
 */

/** emulator 在 WHPX 缺失时的致命句式（官方输出，线上多源核实一致） */
export const WHPX_FATAL_SENTENCE = 'x86 emulation currently requires hardware acceleration'
/** WHPX 未安装的组合特征：产品名与 not installed 同现（分别命中即算） */
export const WHPX_PLATFORM_NAME = 'windows hypervisor platform'
export const WHPX_MISSING_MARKER = 'not installed'

export interface WhpxProbeInput {
  stderrTail: string
  stdoutTail: string
}

/** 失败收口信息是否指向 WHPX 未开启（大小写不敏感；两路 tail 拼接后匹配） */
export const looksLikeWhpxMissing = (info: WhpxProbeInput): boolean => {
  const text = `${info.stderrTail}\n${info.stdoutTail}`.toLowerCase()
  if (text.includes(WHPX_FATAL_SENTENCE)) return true
  return text.includes(WHPX_PLATFORM_NAME) && text.includes(WHPX_MISSING_MARKER)
}
