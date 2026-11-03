import { getRecordingSource, subscribeRecordingSource, requestRecordingKeyFrame } from './recording'
import { createManagerContext } from './context'
import { registerIpc } from './ipc'
import { destroyAll, destroySession } from './lifecycle'
import { ensureSession } from './session'
import type { ScrcpyManager, ScrcpyManagerDeps } from './types'

export { ACK_STALL_MS, MAX_UNACKED_BYTES, MAX_UNACKED_PACKETS } from './types'
export type { ScrcpyManager, ScrcpyManagerDeps } from './types'

export function createScrcpyManager(deps: ScrcpyManagerDeps): ScrcpyManager {
  const ctx = createManagerContext(deps)
  return {
    getRecordingSource: (id) => getRecordingSource(ctx, id),
    subscribeRecordingSource: (identity, observer) =>
      subscribeRecordingSource(ctx, identity, observer),
    requestRecordingKeyFrame: (identity) => requestRecordingKeyFrame(ctx, identity),
    ensureSession: (device) => ensureSession(ctx, device),
    destroySession: (deviceId) => destroySession(ctx, deviceId),
    destroyAll: () => destroyAll(ctx),
    activeDeviceId: () => ctx.active?.deviceId ?? null,
    registerIpc: () => registerIpc(ctx)
  }
}
