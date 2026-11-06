import { getRecordingSource, subscribeRecordingSource, requestRecordingKeyFrame } from './recording'
import { createManagerContext } from './context'
import { registerIpc } from './ipc'
import { destroyAll, destroySession } from './lifecycle'
import { ensureSession } from './session'
import { releaseInput } from './control'
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
    releaseInputs: async (deviceId) => {
      const session = ctx.sessions.get(deviceId)
      const writer = session?.writer
      if (!session || !writer) return
      await releaseInput({
        writer,
        width: session.format.width,
        height: session.format.height,
        pressedPointers: session.pressedPointers,
        pressedKeys: session.pressedKeys,
        clipboardPaste: () => Promise.resolve(),
        lockRotation: () => Promise.resolve()
      })
    },
    destroyAll: () => destroyAll(ctx),
    suspendForAdbRecovery: async () => {
      const active = ctx.active
      await destroyAll(ctx)
      ctx.active = active
    },
    activeDeviceId: () => ctx.active?.deviceId ?? null,
    registerIpc: () => registerIpc(ctx)
  }
}
