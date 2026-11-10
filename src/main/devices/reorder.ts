import type { DeviceSnapshot } from '@shared/types'
import { msg } from '../locale'
import { assertMetaWritable, commitMetas } from './persistence'
import { ensureLoaded } from './scan'
import { broadcastChanged, snapshotNow } from './state'

// 整单重排（plan 2026-11-09-device-list-drag-reorder）：数组序即持久化序，零 schema
// 变更。集合校验在 commitMetas 临界区内对 acceptedMetas 复验——长度相等、无重复、
// 全部已知；陈旧全序（并发增删后）整单拒绝不落盘，renderer 失败重拉收敛。

export const reorderDevices = async (ids: string[]): Promise<DeviceSnapshot> => {
  await ensureLoaded()
  assertMetaWritable(msg('actionReorder'))
  await commitMetas((metas) => {
    if (ids.length !== metas.length || new Set(ids).size !== ids.length) {
      throw new Error(msg('invalidPayload'))
    }
    const byId = new Map(metas.map((meta) => [meta.id, meta]))
    return ids.map((id) => {
      const meta = byId.get(id)
      if (meta === undefined) throw new Error(msg('invalidPayload'))
      return meta
    })
  })
  broadcastChanged()
  return snapshotNow()
}
