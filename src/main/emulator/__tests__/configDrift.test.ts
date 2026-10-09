// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { configBaseline, configMiB, configMismatchesOf } from '../configDrift'
import { applyConfigPatchToText, buildConfigEditPatch, parseConfigEntries } from '../deviceConfig'
import { buildCapabilities } from '../settings'

const stored = buildCapabilities({
  profile: { id: 'pixel_8', formFactor: 'phone', ramMiB: 2048 },
  imagePackageName: 'pkg',
  emulatorVersion: null
}).defaults
const deps = {
  skinIds: ['sdk:pixel_7', 'imported:custom'],
  skinDirectoryFor: (id: string): string => `/skins/${id}`
}

describe('配置差异的语义解析', () => {
  it.each([
    ['228', 228],
    ['228M', 228],
    ['228MiB', 228],
    ['2G', 2048],
    ['2GiB', 2048]
  ] as const)('%s → %i MiB', (raw, value) => {
    expect(configMiB(raw)).toBe(value)
  })
  it.each(['0', '-1', 'auto', '2G;reboot', '999999999999999999999G'])('%s 保持未知', (raw) => {
    expect(configMiB(raw)).toBeNull()
  })
  it('等价单位不警告，存储/未知键不进入同步集合', () => {
    expect(
      configMismatchesOf(
        stored,
        parseConfigEntries(
          'hw.ramSize=2G\nvm.heapSize=256M\ndisk.dataPartition.size=10G\nunknown=1'
        ),
        deps
      )
    ).toEqual([])
    expect(configMismatchesOf(null, parseConfigEntries('vm.heapSize=228M'), deps)).toEqual([])
  })
  it('重复键按最终值，228M 可采用为数字', () => {
    expect(
      configMismatchesOf(stored, parseConfigEntries('vm.heapSize=256\nvm.heapSize=228M'), deps)
    ).toEqual([{ field: 'vmHeapMiB', actualLabel: '228 MiB', actualSettings: { vmHeapMiB: 228 } }])
  })
  it('采用保留文件字面量，未采用按表单写回且保留未知键/存储', () => {
    const raw = '# keep\nvm.heapSize=228M\ndisk.dataPartition.size=10G\nunknown=1\n'
    const mismatches = configMismatchesOf(stored, parseConfigEntries(raw), deps)
    const baseline = configBaseline(stored, mismatches)
    const adopted = buildConfigEditPatch(baseline, { ...stored, vmHeapMiB: 228 }, deps)
    expect(applyConfigPatchToText(raw, adopted)).toBe(raw)
    const overwrite = buildConfigEditPatch(baseline, stored, deps)
    expect(overwrite.sets).toEqual({ 'vm.heapSize': '256' })
    expect(applyConfigPatchToText(raw, overwrite)).toBe(raw.replace('228M', '256'))
  })
  it('未知实际值不可采用，但显式同步能强制写回安全白名单', () => {
    const mismatches = configMismatchesOf(stored, parseConfigEntries('hw.ramSize=auto'), deps)
    expect(mismatches[0].actualSettings).toBeNull()
    expect(buildConfigEditPatch(stored, stored, { ...deps, forceFields: ['ramMiB'] }).sets).toEqual(
      { 'hw.ramSize': '2048' }
    )
  })
  it('相机可采用枚举 id，同一 id 保留稳定身份，不因 host 信息误报', () => {
    const withCamera = {
      ...stored,
      frontCamera: { mode: 'webcam' as const, deviceId: 'webcam0', hostDeviceId: 'MacBook' }
    }
    expect(
      configMismatchesOf(withCamera, parseConfigEntries('hw.camera.front=webcam0'), deps)
    ).toEqual([])
    expect(
      configMismatchesOf(withCamera, parseConfigEntries('hw.camera.front=webcam1'), deps)[0]
        .actualSettings
    ).toEqual({ frontCamera: { mode: 'webcam', deviceId: 'webcam1' } })
  })
  it('virtualScene：config 小写合法值不误报偏差', () => {
    const withScene = { ...stored, frontCamera: { mode: 'virtualScene' as const, deviceId: null } }
    expect(
      configMismatchesOf(withScene, parseConfigEntries('hw.camera.front=virtualscene'), deps)
    ).toEqual([])
    // 与场景不同的合法值仍正常报告为可采用的偏差
    const drifted = configMismatchesOf(
      withScene,
      parseConfigEntries('hw.camera.front=none'),
      deps
    )[0]
    expect(drifted.actualSettings).toEqual({ frontCamera: { mode: 'none', deviceId: null } })
  })

  it.each([
    ['frontCamera', 'hw.camera.front'],
    ['rearCamera', 'hw.camera.back']
  ] as const)('%s 的历史 camelCase 不可采用，原样保存也修正字面量', (field, key) => {
    const withScene = { ...stored, [field]: { mode: 'virtualScene' as const, deviceId: null } }
    const raw = `${key}=virtualScene\ndisk.dataPartition.size=10G\nunknown=keep\n`
    const mismatches = configMismatchesOf(withScene, parseConfigEntries(raw), deps)
    expect(mismatches).toEqual([{ field, actualLabel: 'virtualScene', actualSettings: null }])
    const patch = buildConfigEditPatch(configBaseline(withScene, mismatches), withScene, {
      ...deps,
      forceFields: mismatches
        .filter((item) => item.actualSettings === null)
        .map((item) => item.field)
    })
    expect(applyConfigPatchToText(raw, patch)).toBe(raw.replace('virtualScene', 'virtualscene'))
    expect(
      configMismatchesOf(withScene, parseConfigEntries(applyConfigPatchToText(raw, patch)), deps)
    ).toEqual([])
  })
  it('皮肤采用必须能识别枚举和路径，朝向必须为合法枚举', () => {
    const original = { ...stored, skinRef: 'sdk:pixel_8', orientation: 'portrait' as const }
    const valid = configMismatchesOf(
      original,
      parseConfigEntries('skin.name=pixel_7\nhw.initialOrientation=landscape'),
      deps
    )
    expect(valid.map((item) => item.actualSettings)).toEqual([
      { orientation: 'landscape' },
      { skinRef: 'sdk:pixel_7' }
    ])
    const unknown = configMismatchesOf(
      original,
      parseConfigEntries('skin.name=custom\nskin.path=/outside\nhw.initialOrientation=auto'),
      deps
    )
    expect(unknown.every((item) => item.actualSettings === null)).toBe(true)
  })
})
