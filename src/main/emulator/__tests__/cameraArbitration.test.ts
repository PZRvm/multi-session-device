// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { arbitrateCameras, type ArbitrationSide } from '../cameraArbitration'

const side = (overrides: Partial<ArbitrationSide> & { id: string }): ArbitrationSide => ({
  name: `设备${overrides.id}`,
  front: null,
  rear: null,
  ...overrides
})

describe('cameraArbitration（设计决定 2026-10-09：启动先到先得 + 模拟画面回退）', () => {
  it('无更早占用：真实摄像头保留，无回退无通知', () => {
    const result = arbitrateCameras({
      target: side({ id: 'a', front: { deviceId: 'webcam0' } }),
      others: [],
      labels: new Map([['webcam0', 'FaceTime HD']])
    })
    expect(result).toEqual({ front: false, rear: false, notices: [] })
  })

  it('更早设备同宿主身份：后启动方对应槽位回退并给出占用方名称', () => {
    const result = arbitrateCameras({
      target: side({ id: 'b', front: { deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' } }),
      others: [side({ id: 'a', rear: { deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' } })],
      labels: new Map([['webcam0', 'FaceTime HD']])
    })
    expect(result.front).toBe(true)
    expect(result.rear).toBe(false)
    expect(result.notices).toHaveLength(1)
    expect(result.notices[0]).toContain('前置摄像头')
    expect(result.notices[0]).toContain('设备a')
    expect(result.notices[0]).toContain('模拟画面')
  })

  it('编号重排（复查 P3-4）：两边都有宿主身份且不同，编号相同也不误判占用', () => {
    const result = arbitrateCameras({
      target: side({ id: 'b', front: { deviceId: 'webcam0', hostDeviceId: '旧相机' } }),
      others: [side({ id: 'a', front: { deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' } })],
      labels: new Map([['webcam0', 'FaceTime HD']])
    })
    expect(result.front).toBe(false)
    expect(result.notices).toEqual([])
  })

  it('枚举解析到不同宿主身份：不同物理摄像头不冲突；同身份冲突', () => {
    const labels = new Map([
      ['webcam0', 'FaceTime HD'],
      ['webcam1', '外接相机']
    ])
    const earlier = side({ id: 'a', front: { deviceId: 'webcam0' } })
    expect(
      arbitrateCameras({
        target: side({ id: 'b', front: { deviceId: 'webcam1' } }),
        others: [earlier],
        labels
      }).front
    ).toBe(false)
    expect(
      arbitrateCameras({
        target: side({ id: 'b', rear: { deviceId: 'webcam0' } }),
        others: [earlier],
        labels
      }).rear
    ).toBe(true)
  })

  it('一侧无法解析时退化为编号比较（保守视为同一颗）', () => {
    // 目标的 webcam1 已不在枚举（拔出），占用方为无身份的 webcam1：同号保守回退
    const result = arbitrateCameras({
      target: side({ id: 'b', front: { deviceId: 'webcam1' } }),
      others: [side({ id: 'a', front: { deviceId: 'webcam1' } })],
      labels: new Map([['webcam0', 'FaceTime HD']])
    })
    expect(result.front).toBe(true)
  })

  it('legacy 死绑定：枚举成功但资源号不在枚举又无宿主身份 → 回退并说明已不可用', () => {
    const result = arbitrateCameras({
      target: side({ id: 'b', front: { deviceId: 'webcam9' } }),
      others: [],
      labels: new Map([['webcam0', 'FaceTime HD']])
    })
    expect(result.front).toBe(true)
    expect(result.notices[0]).toContain('webcam9')
    expect(result.notices[0]).toContain('已不可用')
  })

  it('枚举失败（labels=null）：跳过死绑定判断，仅按宿主身份/编号比较', () => {
    // webcam9 无法证明不存在（枚举失败）——不触发死绑定回退
    expect(
      arbitrateCameras({
        target: side({ id: 'b', front: { deviceId: 'webcam9' } }),
        others: [],
        labels: null
      }).front
    ).toBe(false)
    // 但同号占用仍按编号保守回退
    expect(
      arbitrateCameras({
        target: side({ id: 'b', front: { deviceId: 'webcam9' } }),
        others: [side({ id: 'a', front: { deviceId: 'webcam9' } })],
        labels: null
      }).front
    ).toBe(true)
  })

  it('前后双槽独立裁决：一槽冲突另一槽保留', () => {
    const result = arbitrateCameras({
      target: side({
        id: 'b',
        front: { deviceId: 'webcam0' },
        rear: { deviceId: 'webcam1' }
      }),
      others: [side({ id: 'a', front: { deviceId: 'webcam0' } })],
      labels: new Map([
        ['webcam0', 'FaceTime HD'],
        ['webcam1', '外接相机']
      ])
    })
    expect(result.front).toBe(true)
    expect(result.rear).toBe(false)
  })
})
