// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { listWebcams, parseWebcamList } from '../cameras'

/** 真实输出样本（批次 1/8 本机实测，emulator 36.1.9） */
const REAL_OUTPUT = `2026-10-05 23:58:00.300 emulator[39282:36108579] WARNING: AVCaptureDeviceTypeExternal is deprecated for Continuity Cameras.
List of web cameras connected to the computer:
 Camera 'webcam0' is connected to device '6C707041-05AC-0010-0001-000000000001' on channel 0 using pixel format 'YV12'
 Camera 'webcam1' is connected to device 'F79521C9-459A-4638-992D-D97300000001' on channel 0 using pixel format 'YV12'
`

describe('parseWebcamList', () => {
  it('解析 webcam0/webcam1 与宿主设备标识；无摄像头返回空', () => {
    expect(parseWebcamList(REAL_OUTPUT)).toEqual([
      { id: 'webcam0', deviceLabel: '6C707041-05AC-0010-0001-000000000001' },
      { id: 'webcam1', deviceLabel: 'F79521C9-459A-4638-992D-D97300000001' }
    ])
    expect(parseWebcamList('List of web cameras connected to the computer:')).toEqual([])
    expect(parseWebcamList('')).toEqual([])
  })
})

describe('listWebcams（注入接缝）', () => {
  it('经 runner 拿输出并解析；枚举失败抛中文错误', async () => {
    const webcams = await listWebcams('/sdk', { runner: async () => REAL_OUTPUT })
    expect(webcams.map((entry) => entry.id)).toEqual(['webcam0', 'webcam1'])
    // 注入 runner 的自身错误透传（defaultRunner 的 exit 非 0 包装测不到——注入场景）
    await expect(
      listWebcams('/sdk', {
        runner: async () => {
          throw new Error('spawn ENOENT')
        }
      })
    ).rejects.toThrow('spawn ENOENT')
  })
})
