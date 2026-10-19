import { create } from 'zustand'
import type { RecordingCommand, RecordingSnapshot } from '@shared/recording'
import { toApiResult } from '../api'
interface RecordingStore {
  snapshot: RecordingSnapshot
  /** 失败队列：并发失败逐条弹窗，不互相覆盖 */
  errors: string[]
  pending: string[]
  apply: (snapshot: RecordingSnapshot) => void
  dismissError: () => void
  start: (deviceId: string) => Promise<void>
  command: (taskId: string, command: RecordingCommand) => Promise<void>
}
export const useRecordingStore = create<RecordingStore>()((set, get) => {
  const request = async (key: string, call: () => Promise<RecordingSnapshot>): Promise<void> => {
    if (get().pending.includes(key)) return
    set((state) => ({ pending: [...state.pending, key] }))
    try {
      const result = await toApiResult(call())
      if (result.ok) get().apply(result.data)
      else set((state) => ({ errors: [...state.errors, result.error] }))
    } finally {
      set((state) => ({ pending: state.pending.filter((entry) => entry !== key) }))
    }
  }
  return {
    snapshot: { revision: -1, tasks: [], limit: 0 },
    errors: [],
    pending: [],
    apply: (snapshot) => {
      if (snapshot.revision >= get().snapshot.revision) set({ snapshot })
    },
    dismissError: () => set((state) => ({ errors: state.errors.slice(1) })),
    start: (deviceId) => request(deviceId, () => window.api.recording.start(deviceId)),
    command: (taskId, command) =>
      request(taskId, () => window.api.recording.command(taskId, command))
  }
})
/** 唯一主窗订阅；先安装 listener，再拉 snapshot，revision 拒绝迟到响应。 */
export const subscribeRecordings = (): (() => void) => {
  if (!window.api?.recording) return () => undefined
  const unsubscribe = window.api.recording.onChanged((snapshot) =>
    useRecordingStore.getState().apply(snapshot)
  )
  void toApiResult(window.api.recording.get()).then((result) => {
    if (result.ok) useRecordingStore.getState().apply(result.data)
    else useRecordingStore.setState((state) => ({ errors: [...state.errors, result.error] }))
  })
  return unsubscribe
}
