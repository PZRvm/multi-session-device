// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { looksLikeWhpxMissing, WHPX_FATAL_SENTENCE } from '../whpx'

describe('WHPX 缺失匹配（plan 2026-10-22-windows-emulator-env）', () => {
  const probe = (stderrTail = '', stdoutTail = ''): { stderrTail: string; stdoutTail: string } => ({
    stderrTail,
    stdoutTail
  })

  it('官方致命句式命中：stdout-only / stderr-only / 大小写不敏感', () => {
    expect(
      looksLikeWhpxMissing(probe('', `x86 emulation currently requires hardware acceleration!`))
    ).toBe(true)
    expect(looksLikeWhpxMissing(probe(WHPX_FATAL_SENTENCE.toUpperCase(), ''))).toBe(true)
  })

  it('组合特征：Windows Hypervisor Platform 与 not installed 同现（可跨 tail）', () => {
    expect(looksLikeWhpxMissing(probe('Windows Hypervisor Platform is not installed', ''))).toBe(
      true
    )
    expect(looksLikeWhpxMissing(probe('Windows Hypervisor Platform', 'error: not installed'))).toBe(
      true
    )
  })

  it('不命中：普通崩溃 / 端口冲突 / 只有产品名没有 not installed', () => {
    expect(looksLikeWhpxMissing(probe('PANIC: gpu failure', ''))).toBe(false)
    expect(looksLikeWhpxMissing(probe('', 'another emulator instance occupies console 5554'))).toBe(
      false
    )
    expect(looksLikeWhpxMissing(probe('WHPX warning: feature deprecated', ''))).toBe(false)
    expect(looksLikeWhpxMissing(probe('', 'exit 1'))).toBe(false)
  })
})
