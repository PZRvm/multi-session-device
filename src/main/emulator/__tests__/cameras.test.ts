// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  listWebcams,
  parseWebcamList,
  readCameraSnapshot,
  requestCameraPermission
} from '../cameras'

const permissionMocks = vi.hoisted(() => ({
  status: vi.fn(() => 'denied'),
  ask: vi.fn(async () => true)
}))
vi.mock('electron', () => ({
  systemPreferences: {
    getMediaAccessStatus: permissionMocks.status,
    askForMediaAccess: permissionMocks.ask
  }
}))

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

describe('emulator 37 摄像头输出', () => {
  it('中文友好名称与稳定宿主 id，兼容 37.2.12 实测格式', () => {
    const output =
      " Camera 'MacBook Pro相机' can be specified by label as 'webcam0' or by id as 'mac-camera-id' and will use pixel format 'NV12'"
    expect(parseWebcamList(output)).toEqual([
      { id: 'webcam0', deviceLabel: 'mac-camera-id', name: 'MacBook Pro相机' }
    ])
  })
  it('重复输出只列一次，异常 Camera 行不冒充无硬件', async () => {
    expect(parseWebcamList(REAL_OUTPUT + REAL_OUTPUT)).toHaveLength(2)
    await expect(
      listWebcams('/sdk', { runner: async () => "Camera 'unknown' changed format" })
    ).rejects.toThrow('格式')
  })
})

describe('摄像头权限与诊断', () => {
  it('枚举进程失败与拒绝权限分别保存，不用空数组吞掉原因', async () => {
    const result = await readCameraSnapshot('/missing-sdk')
    expect(result.permission).toBe('denied')
    expect(result.devices).toEqual([])
    expect(result.error).toMatch(/ENOENT|失败/)
  })
  it('并发申请合并为一次系统请求', async () => {
    permissionMocks.ask.mockClear()
    await Promise.all([requestCameraPermission(), requestCameraPermission()])
    expect(permissionMocks.ask).toHaveBeenCalledTimes(1)
  })
})
