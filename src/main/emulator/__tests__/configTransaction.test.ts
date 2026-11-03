// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DeviceMeta } from '@shared/types'
import {
  journalPathOf,
  recoverPendingTransactions,
  removeJournal,
  transactionsDir,
  writeJournal,
  type ConfigTransactionJournal,
  type RecoveryResult
} from '../configTransaction'

const metaOf = (name: string, overrides: Partial<DeviceMeta> = {}): DeviceMeta => ({
  id: '018f1c2d-0000-4000-8000-000000000001',
  name,
  profileId: 'pixel_8',
  profileLabel: 'Pixel 8',
  imagePackageName: 'system-images;android-34;default;arm64-v8a',
  apiDisplay: '34',
  formFactor: 'phone',
  screenSummary: null,
  advancedSettings: null,
  snapshotReadyAt: null,
  createdAt: 0,
  ...overrides
})

describe('configTransaction（journal 读写与恢复）', () => {
  let root: string
  let dir: string
  let configs: Map<string, string | null>
  let journals: number[]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'msd-config-tx-'))
    dir = transactionsDir(root)
    configs = new Map()
    journals = []
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const journalOf = (
    overrides: Partial<ConfigTransactionJournal> = {}
  ): ConfigTransactionJournal => ({
    version: 1,
    deviceId: '018f1c2d-0000-4000-8000-000000000001',
    createdAt: 42,
    oldConfig: 'old-config\n',
    newConfig: 'new-config\n',
    oldMeta: metaOf('旧名'),
    newMeta: metaOf('新名'),
    ...overrides
  })

  const recover = (metas: DeviceMeta[]): Promise<RecoveryResult> =>
    recoverPendingTransactions({
      dir,
      readMetas: async () => metas,
      configRawOf: async (id) => configs.get(id) ?? null,
      writeConfigRaw: async (id, content) => {
        journals.push(1)
        configs.set(id, content)
      },
      removeDeviceJournal: async (id) => removeJournal(dir, id)
    })

  it('writeJournal 落盘 journalPathOf 指向的文件；removeJournal 删除', async () => {
    const journal = journalOf()
    await writeJournal(dir, journal)
    const raw = JSON.parse(await readFile(journalPathOf(dir, journal.deviceId), 'utf8'))
    expect(raw.deviceId).toBe(journal.deviceId)
    await removeJournal(dir, journal.deviceId)
    await expect(readFile(journalPathOf(dir, journal.deviceId), 'utf8')).rejects.toThrow()
  })

  it('元数据已是 new：补写 new config 并清理记录', async () => {
    const journal = journalOf()
    configs.set(journal.deviceId, journal.oldConfig)
    await writeJournal(dir, journal)
    const result = await recover([journal.newMeta])
    expect(result.completed).toEqual([journal.deviceId])
    expect(configs.get(journal.deviceId)).toBe('new-config\n')
    await expect(readFile(journalPathOf(dir, journal.deviceId), 'utf8')).rejects.toThrow()
  })

  it('元数据已是 new 且 config 已是目标内容：幂等跳过写入，仍清理记录', async () => {
    const journal = journalOf()
    configs.set(journal.deviceId, 'new-config\n')
    await writeJournal(dir, journal)
    const result = await recover([journal.newMeta])
    expect(result.completed).toEqual([journal.deviceId])
    expect(journals).toEqual([])
  })

  it('元数据仍是 old：回滚 config 到原文并清理记录', async () => {
    const journal = journalOf()
    configs.set(journal.deviceId, 'new-config\n')
    await writeJournal(dir, journal)
    const result = await recover([journal.oldMeta])
    expect(result.rolledBack).toEqual([journal.deviceId])
    expect(configs.get(journal.deviceId)).toBe('old-config\n')
  })

  it('元数据与 old/new 都不一致（外部第三种内容）：不覆盖 config、冻结目标、记录保留', async () => {
    const journal = journalOf()
    configs.set(journal.deviceId, 'external\n')
    await writeJournal(dir, journal)
    const result = await recover([metaOf('外部改名')])
    expect(result.frozen).toHaveLength(1)
    expect(result.frozen[0].deviceId).toBe(journal.deviceId)
    expect(configs.get(journal.deviceId)).toBe('external\n')
    await expect(readFile(journalPathOf(dir, journal.deviceId), 'utf8')).resolves.toBeTruthy()
  })

  it('设备已删除：记录作废清理，不触碰其他设备', async () => {
    const journal = journalOf()
    await writeJournal(dir, journal)
    const other = metaOf('其他设备', { id: '018f1c2d-0000-4000-8000-000000000002' })
    const result = await recover([other])
    expect(result.completed).toEqual([])
    expect(result.rolledBack).toEqual([])
    expect(result.frozen).toEqual([])
    await expect(readFile(journalPathOf(dir, journal.deviceId), 'utf8')).rejects.toThrow()
  })

  it('恢复写入失败：冻结目标并保留记录', async () => {
    const journal = journalOf()
    configs.set(journal.deviceId, journal.oldConfig)
    await writeJournal(dir, journal)
    const result = await recoverPendingTransactions({
      dir,
      readMetas: async () => [journal.newMeta],
      configRawOf: async (id) => configs.get(id) ?? null,
      writeConfigRaw: async () => {
        throw new Error('磁盘只读')
      },
      removeDeviceJournal: async (id) => removeJournal(dir, id)
    })
    expect(result.frozen).toHaveLength(1)
    expect(result.frozen[0].message).toContain('磁盘只读')
    expect(result.frozen[0].message).toContain(journalPathOf(dir, journal.deviceId))
  })

  it('损坏的 journal 文件：进入冻结列表并保留文件', async () => {
    await mkdir(dir, { recursive: true })
    const broken = join(dir, '018f1c2d-dead-beef-0000-000000000009.json')
    await writeFile(broken, 'not-json', 'utf8')
    const result = await recover([])
    expect(result.frozen).toHaveLength(1)
    expect(result.frozen[0].message).toContain('无法解析')
    await expect(readFile(broken, 'utf8')).resolves.toBe('not-json')
  })

  it('目录不存在：静默返回空结果', async () => {
    const result = await recover([])
    expect(result).toEqual({ completed: [], rolledBack: [], frozen: [] })
  })

  it('journal 键序与 store 读回不同不影响裁决（键序无关比较）', async () => {
    const journal = journalOf()
    configs.set(journal.deviceId, journal.newConfig)
    await writeJournal(dir, journal)
    // 手工重排 meta 全部键序后写回（模拟外部工具重排 JSON；字段集合不变）
    const reorder = (meta: DeviceMeta): Record<string, unknown> => {
      const entries = Object.entries(meta as unknown as Record<string, unknown>).reverse()
      return Object.fromEntries(entries)
    }
    await writeFile(
      journalPathOf(dir, journal.deviceId),
      JSON.stringify({
        ...journal,
        newMeta: reorder(journal.newMeta),
        oldMeta: reorder(journal.oldMeta)
      }),
      'utf8'
    )
    const result = await recover([journal.newMeta])
    expect(result.completed).toEqual([journal.deviceId])
  })

  it.each(['old', 'new'] as const)(
    '元数据为 %s，但 config 是外部内容或已删除：冻结且不覆盖',
    async (state) => {
      const journal = journalOf()
      await writeJournal(dir, journal)
      for (const current of ['external=1\n', null]) {
        configs.set(journal.deviceId, current)
        const result = await recover([state === 'old' ? journal.oldMeta : journal.newMeta])
        expect(result.frozen).toHaveLength(1)
        expect(result.completed).toEqual([])
        expect(result.rolledBack).toEqual([])
        expect(configs.get(journal.deviceId)).toBe(current)
        expect(journals).toEqual([])
        await expect(readFile(journalPathOf(dir, journal.deviceId), 'utf8')).resolves.toBeTruthy()
      }
    }
  )

  it.each(['read', 'cleanup'] as const)('单设备 %s 失败不打断其他设备的恢复', async (failure) => {
    const first = journalOf()
    const second = journalOf({
      deviceId: '018f1c2d-0000-4000-8000-000000000002',
      oldMeta: metaOf('旧二', { id: '018f1c2d-0000-4000-8000-000000000002' }),
      newMeta: metaOf('新二', { id: '018f1c2d-0000-4000-8000-000000000002' })
    })
    await writeJournal(dir, first)
    await writeJournal(dir, second)
    const result = await recoverPendingTransactions({
      dir,
      readMetas: async () => [first.newMeta, second.newMeta],
      configRawOf: async (id) => {
        if (failure === 'read' && id === first.deviceId) throw new Error('无法读取')
        return first.newConfig
      },
      writeConfigRaw: async () => {
        throw new Error('不应写入')
      },
      removeDeviceJournal: async (id) => {
        if (failure === 'cleanup' && id === first.deviceId) throw new Error('无法清理')
        await removeJournal(dir, id)
      }
    })
    expect(result.frozen.map((entry) => entry.deviceId)).toEqual([first.deviceId])
    expect(result.completed).toEqual([second.deviceId])
  })
})
