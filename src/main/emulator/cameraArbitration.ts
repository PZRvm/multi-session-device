import { msg } from '../locale'
/** 摄像头启动仲裁（设计决定 2026-10-09，issue 复查 P2-3 / P3-4）。纯函数，IO 注入。 */

/** 仲裁用摄像头绑定：webcam 资源号（webcamN）+ 可选稳定宿主身份 */
export interface ArbitrationCamera {
  deviceId: string
  hostDeviceId?: string
}

export interface ArbitrationSide {
  id: string
  name: string
  front: ArbitrationCamera | null
  rear: ArbitrationCamera | null
}

export interface CameraArbitrationInput {
  target: ArbitrationSide
  /** 比 target 更早进入启动/运行的设备（先后过滤由调用方负责） */
  others: ArbitrationSide[]
  /** 当前 webcamN → 稳定宿主身份枚举；null = 枚举失败（跳过死绑定判断） */
  labels: Map<string, string> | null
}

export interface CameraArbitrationResult {
  /** 命中冲突/死绑定的槽位：true = 本次启动回退模拟画面 */
  front: boolean
  rear: boolean
  /** 行内通知文案（每槽一条） */
  notices: string[]
}

const SLOT_LABELS = { front: msg('slotFront'), rear: msg('slotRear') } as const

/**
 * 比较键：稳定宿主身份优先，当前枚举次之，最后退化为资源号（复查 P3-4——
 * 宿主身份都存在时编号重排不误伤；任一侧无法解析时同号保守视为同一颗）。
 * hostDeviceId 与枚举值同源（listWebcams 的 deviceLabel），可直接比较。
 */
export const cameraKeyOf = (
  camera: ArbitrationCamera,
  labels: Map<string, string> | null
): string => camera.hostDeviceId ?? labels?.get(camera.deviceId) ?? camera.deviceId

/**
 * 先到先得：更早的运行中设备保住真实摄像头，后启动方的冲突槽位回退模拟画面
 * （argv 只接受 emulated/webcamN/none 等，不接受 virtualscene——37.2.12 隔离实测
 * exit 1）；legacy 死绑定（无宿主身份、枚举成功但资源号已不在枚举）同样回退——
 * 不带失效绑定启动。托管设置的失效摄像头不在此处理（verifyWebcamsFor 启动前阻断）。
 */
export const arbitrateCameras = (input: CameraArbitrationInput): CameraArbitrationResult => {
  const result: CameraArbitrationResult = { front: false, rear: false, notices: [] }
  const slots = [
    ['front', input.target.front],
    ['rear', input.target.rear]
  ] as const
  for (const [slot, camera] of slots) {
    if (camera === null) continue
    const holder = input.others.find((other) =>
      [other.front, other.rear].some(
        (bound) =>
          bound !== null && cameraKeyOf(bound, input.labels) === cameraKeyOf(camera, input.labels)
      )
    )
    if (holder !== undefined) {
      result[slot] = true
      result.notices.push(
        msg('cameraOccupiedNotice', { slot: SLOT_LABELS[slot], holder: holder.name })
      )
      continue
    }
    if (
      camera.hostDeviceId === undefined &&
      input.labels !== null &&
      !input.labels.has(camera.deviceId)
    ) {
      result[slot] = true
      result.notices.push(
        msg('cameraUnavailableNotice', { slot: SLOT_LABELS[slot], deviceId: camera.deviceId })
      )
    }
  }
  return result
}
