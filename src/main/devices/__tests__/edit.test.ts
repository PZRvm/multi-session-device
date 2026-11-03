// 配置编辑域：readConfig/updateConfig/摄像头仲裁/首载恢复（源码 edit.ts，嵌套块保持原结构）
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { DeviceMeta } from '@shared/types'
import {
  freshDomain,
  mainWindowEvent,
  mocks,
  startThroughPreflight,
  validCreateInput
} from './harness'

describe('配置编辑域（plan 2026-10-08-device-config-edit）', () => {
  const DEVICE_ID = '018f1c2d-aaaa-4000-8000-000000000001'
  const OTHER_ID = '018f1c2d-bbbb-4000-8000-000000000002'
  const CONFIG_RAW = [
    'avd.ini.encoding=UTF-8',
    'hw.ramSize=2048',
    'hw.cpu.ncore=4',
    'vm.heapSize=256',
    'hw.gpu.mode=auto',
    'hw.camera.front=emulated',
    'hw.camera.back=emulated',
    'disk.dataPartition.size=6144M',
    ''
  ].join('\n')

  const editSettings = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    skinRef: null,
    frontCamera: { mode: 'emulated', deviceId: null },
    rearCamera: { mode: 'emulated', deviceId: null },
    networkSpeed: null,
    networkLatency: null,
    orientation: null,
    bootMode: 'cold',
    internalStorageMiB: 6144,
    cpuCores: 4,
    graphics: 'auto',
    ramMiB: 2048,
    vmHeapMiB: 256,
    preferredAbi: 'optimal',
    ...overrides
  })

  const editDevice = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: DEVICE_ID,
    name: '编辑机',
    profileId: 'pixel_8',
    profileLabel: 'Pixel 8',
    imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
    apiDisplay: '36',
    formFactor: 'phone',
    screenSummary: null,
    advancedSettings: editSettings(),
    snapshotReadyAt: 999,
    createdAt: 0,
    status: 'stopped',
    ...overrides
  })

  const editCaps = (): Record<string, unknown> => ({
    capabilityContextId: 'pixel_8|pkg|36.1.9|edit',
    emulatorVersion: '36.1.9',
    defaults: editSettings(),
    fields: {
      skinRef: { disabledReason: null, min: null, max: null, step: null },
      frontCamera: { disabledReason: null, min: null, max: null, step: null },
      rearCamera: { disabledReason: null, min: null, max: null, step: null },
      networkSpeed: { disabledReason: null, min: null, max: null, step: null },
      networkLatency: { disabledReason: null, min: null, max: null, step: null },
      orientation: { disabledReason: null, min: null, max: null, step: null },
      bootMode: { disabledReason: '门槛未过', min: null, max: null, step: null },
      internalStorageMiB: { disabledReason: null, min: 2048, max: 65536, step: 1 },
      cpuCores: { disabledReason: null, min: 1, max: 8, step: 1 },
      graphics: { disabledReason: null, min: null, max: null, step: null },
      ramMiB: { disabledReason: null, min: 2048, max: 32768, step: 1 },
      vmHeapMiB: { disabledReason: null, min: 64, max: 1024, step: 1 },
      preferredAbi: { disabledReason: '跨架构二期', min: null, max: null, step: null }
    },
    quickBootAvailable: false,
    quickBootDisabledReason: '门槛未过',
    webcamDeviceIds: ['webcam0', 'webcam1'],
    cameraSnapshot: {
      permission: 'granted',
      error: null,
      devices: [
        { id: 'webcam0', deviceLabel: 'FaceTime HD' },
        { id: 'webcam1', deviceLabel: '外接相机' }
      ]
    },
    skinIds: []
  })

  /** 编辑窗事件（sender id 9 + 绑定 DEVICE_ID 的 edit 上下文） */
  const editEvent = (): unknown => ({ sender: { id: 9 } })

  const fingerprintOfSnapshot = async (
    handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>
  ): Promise<string> => {
    const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
      id: DEVICE_ID
    })) as { fingerprint: string }
    return snapshot.fingerprint
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
    mocks.readDeviceMetas.mockResolvedValue([editDevice() as never])
    mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
      mocks.fileMetas.current = metas
    })
    mocks.getAllWindows.mockReturnValue([])
    mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
    mocks.readAvdConfigRaw.mockResolvedValue(CONFIG_RAW)
    mocks.writeAvdConfigRaw.mockResolvedValue(undefined)
    mocks.readHardwareSchemaDefaults.mockResolvedValue({})
    mocks.recoverPendingTransactions.mockResolvedValue({
      completed: [],
      rolledBack: [],
      frozen: []
    })
    mocks.writeJournal.mockResolvedValue(undefined)
    mocks.removeJournal.mockResolvedValue(undefined)
    mocks.resetDisplayCutout.mockResolvedValue(undefined)
    mocks.buildEnrichedCapabilities.mockResolvedValue(editCaps() as never)
    mocks.normalizeAdvancedSettings.mockImplementation((raw: unknown) => ({
      settings: raw === null ? null : raw,
      errors: {}
    }))
    mocks.listWebcams.mockResolvedValue([{ id: 'webcam0', deviceLabel: 'FaceTime HD' }])
    mocks.wizardContext.current = { kind: 'edit', deviceId: DEVICE_ID }
    mocks.runnerInstance.disposeAll.mockResolvedValue([])
  })

  describe('readConfig（快照回填）', () => {
    it('绑定编辑窗可读：已存设置按 metadata 回填，存储只读展示，指纹稳定', async () => {
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as {
        settings: { ramMiB: number }
        internalStorage: { valueMiB: number | null; note: string }
        saveBlockedReason: string | null
        fingerprint: string
        identity: { name: string; profileLabel: string }
      }
      expect(snapshot.settings.ramMiB).toBe(2048)
      expect(snapshot.internalStorage.valueMiB).toBe(6144)
      expect(snapshot.internalStorage.note).toContain('不支持修改内部存储')
      expect(snapshot.saveBlockedReason).toBeNull()
      expect(snapshot.identity.name).toBe('编辑机')
      expect(mocks.listDeviceProfiles).toHaveBeenCalledWith(
        expect.objectContaining({ sdkRoot: '/userdata/AndroidSDK' })
      )
      expect(snapshot.fingerprint).toBe(await fingerprintOfSnapshot(handlerFor))
    })

    it('运行中快照分离 status 与文件阻断', async () => {
      const { handlerFor } = await freshDomain()
      startThroughPreflight()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { saveBlockedReason: string | null; status: string }
      expect(snapshot.saveBlockedReason).toBeNull()
      expect(snapshot.status).toBe('starting')
    })

    it('主窗与绑定其他设备的编辑窗都被拒绝', async () => {
      const { handlerFor } = await freshDomain()
      await expect(
        handlerFor(IPC_CHANNELS.devicesReadConfig)(mainWindowEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('本窗口无权读写该设备的配置')
      mocks.wizardContext.current = { kind: 'edit', deviceId: OTHER_ID }
      await expect(
        handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('本窗口无权读写该设备的配置')
    })

    it('legacy（null 设置）：Cold/host 语义 + config 回填；缺省键不冒充', async () => {
      mocks.readDeviceMetas.mockResolvedValue([editDevice({ advancedSettings: null }) as never])
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as {
        settings: { bootMode: string; graphics: string; ramMiB: number; networkSpeed: null }
        internalStorage: { valueMiB: number | null }
      }
      expect(snapshot.settings.bootMode).toBe('cold')
      expect(snapshot.settings.graphics).toBe('host') // runner 的显式 host 覆盖 config auto
      expect(snapshot.settings.ramMiB).toBe(2048)
      expect(snapshot.settings.networkSpeed).toBeNull()
      expect(snapshot.internalStorage.valueMiB).toBe(6144)
    })

    it('config 缺失：快照可读但保存被阻断并说明', async () => {
      mocks.readAvdConfigRaw.mockResolvedValue(null)
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { saveBlockedReason: string | null }
      expect(snapshot.saveBlockedReason).toContain('config.ini 缺失')
    })
  })

  describe('updateConfig（守卫与差异闭集）', () => {
    it('载荷含内部存储/ABI/未知键直接拒绝', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      const base = { id: DEVICE_ID, fingerprint }
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          ...base,
          advancedSettings: { internalStorageMiB: 8192 }
        })
      ).rejects.toThrow('内部存储不允许修改')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          ...base,
          advancedSettings: { preferredAbi: 'arm64-v8a' }
        })
      ).rejects.toThrow('应用 ABI 不允许修改')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          ...base,
          advancedSettings: { profileId: 'pixel_9', ramMiB: 4096 }
        })
      ).rejects.toThrow('非法字段（profileId）')
    })

    it('指纹不一致拒绝（外部改 config 或状态更新）', async () => {
      const { handlerFor } = await freshDomain()
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: 'stale',
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('已发生变化')
    })

    it('运行中拒绝保存（状态守卫先于指纹复验）', async () => {
      const { handlerFor } = await freshDomain()
      startThroughPreflight()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: 'any',
          name: '新名'
        })
      ).rejects.toThrow('请先停止模拟器后再保存')
    })

    it('未改表单也保存同步偏差；只改名同时同步，其他键保持', async () => {
      const raw = CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M') + 'unknown.keep=yes\n'
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        name: '新名'
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(raw.replace('228M', '256'))
      expect(mocks.fileMetas.current![0]).toMatchObject({ name: '新名', snapshotReadyAt: null })
    })

    it('采用文件 heap 后同步元数据，保留 228M 原文并清除差异', async () => {
      const raw = CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M')
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const snap = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { fingerprint: string; configMismatches: Array<{ actualSettings: unknown }> }
      expect(snap.configMismatches).toHaveLength(1)
      expect(snap.configMismatches[0].actualSettings).toEqual({ vmHeapMiB: 228 })
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint: snap.fingerprint,
        advancedSettings: { vmHeapMiB: 228 }
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(raw)
      expect(mocks.fileMetas.current![0].advancedSettings!.vmHeapMiB).toBe(228)
      const again = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { configMismatches: unknown[] }
      expect(again.configMismatches).toEqual([])
    })

    it('部分采用 heap、其余 RAM 按表单同步；等价单位不触发无操作保存', async () => {
      const raw = CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M').replace(
        'hw.ramSize=2048',
        'hw.ramSize=4096'
      )
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { vmHeapMiB: 228 }
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(
        raw.replace('hw.ramSize=4096', 'hw.ramSize=2048')
      )
    })

    it('待同步字段仍校验能力和 RAM/heap 联动，不能以未改输入绕过', async () => {
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M')
      )
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({ advancedSettings: editSettings({ vmHeapMiB: 1200 }) }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), { id: DEVICE_ID, fingerprint })
      ).rejects.toThrow('VM heap')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
      expect(mocks.writeJournal).not.toHaveBeenCalled()
    })

    it('有偏差时外部再改文件仍拒绝，不覆盖第三种内容', async () => {
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=228M')
      )
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('vm.heapSize=256', 'vm.heapSize=240M')
      )
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), { id: DEVICE_ID, fingerprint })
      ).rejects.toThrow('设备配置或状态已发生变化')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('编辑前后摄像头为虚拟场景：事务写入小写，其他配置保持', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: {
          frontCamera: { mode: 'virtualScene', deviceId: null },
          rearCamera: { mode: 'virtualScene', deviceId: null }
        }
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(
        CONFIG_RAW.replace('hw.camera.front=emulated', 'hw.camera.front=virtualscene').replace(
          'hw.camera.back=emulated',
          'hw.camera.back=virtualscene'
        )
      )
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0].advancedSettings?.frontCamera.mode).toBe('virtualScene')
      expect(persisted[0].advancedSettings?.rearCamera.mode).toBe('virtualScene')
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
    })

    it('历史 virtualScene 被报告为不可采用；未改表单保存也修正两槽且保留其他配置', async () => {
      const scene = { mode: 'virtualScene', deviceId: null }
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({
          advancedSettings: editSettings({ frontCamera: scene, rearCamera: scene })
        }) as never
      ])
      const raw = `${CONFIG_RAW.replace(
        'hw.camera.front=emulated',
        'hw.camera.front=virtualScene'
      ).replace('hw.camera.back=emulated', 'hw.camera.back=virtualScene')}unknown=keep\n`
      mocks.readAvdConfigRaw.mockResolvedValue(raw)
      const { handlerFor } = await freshDomain()
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as {
        fingerprint: string
        configMismatches: Array<{ field: string; actualSettings: unknown }>
      }
      expect(snapshot.configMismatches).toEqual([
        { field: 'frontCamera', actualLabel: 'virtualScene', actualSettings: null },
        { field: 'rearCamera', actualLabel: 'virtualScene', actualSettings: null }
      ])
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint: snapshot.fingerprint
      })
      expect(mocks.writeAvdConfigRaw.mock.calls[0][2]).toBe(
        raw.replaceAll('virtualScene', 'virtualscene')
      )
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0].advancedSettings?.frontCamera).toEqual(scene)
      expect(persisted[0].advancedSettings?.rearCamera).toEqual(scene)
      expect(persisted[0].snapshotReadyAt).toBeNull()
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
    })

    it('无差异载荷：幂等返回，不写任何文件', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint
      })
      expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
      expect(mocks.writeJournal).not.toHaveBeenCalled()
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('只改名：走元数据提交，不动 config 与快照标记', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        name: '  新名字  '
      })
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0]!.name).toBe('新名字')
      expect(persisted[0]!.snapshotReadyAt).toBe(999)
      expect(mocks.writeJournal).not.toHaveBeenCalled()
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('RAM 变化：journal→config→元数据事务落盘；存储键不被改写；快照失效', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      const result = (await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { ramMiB: 4096 }
      })) as { devices: Array<{ advancedSettings: { ramMiB: number } | null }> }
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
      const written = mocks.writeAvdConfigRaw.mock.calls[0]![2] as string
      expect(written).toContain('hw.ramSize=4096')
      expect(written).toContain('disk.dataPartition.size=6144M')
      expect(written).not.toContain('disk.dataPartition.size=8')
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0]!.advancedSettings!.ramMiB).toBe(4096)
      expect(persisted[0]!.snapshotReadyAt).toBeNull()
      expect(mocks.removeJournal).toHaveBeenCalledTimes(1)
      expect(result.devices[0]!.advancedSettings!.ramMiB).toBe(4096)
    })

    it('网络字段变化（无 config 键）：快照标记保留，config 原样写回', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { networkSpeed: 'lte' }
      })
      const persisted = mocks.writeDeviceMetas.mock.calls.at(-1)![0] as DeviceMeta[]
      expect(persisted[0]!.advancedSettings!.networkSpeed).toBe('lte')
      expect(persisted[0]!.snapshotReadyAt).toBe(999)
      expect(mocks.writeAvdConfigRaw.mock.calls[0]![2]).toBe(CONFIG_RAW)
    })

    it('元数据写失败：恢复原 config 并清理记录', async () => {
      mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('盘满'))
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('盘满')
      const writes = mocks.writeAvdConfigRaw.mock.calls.map((call) => call[2])
      expect(writes[0]).toContain('hw.ramSize=4096')
      expect(writes[1]).toBe(CONFIG_RAW)
      expect(mocks.removeJournal).toHaveBeenCalledTimes(1)
    })

    it('回滚失败：冻结目标——后续保存拒绝，行内带 config-transaction 错误', async () => {
      mocks.writeDeviceMetas.mockRejectedValue(new Error('盘满'))
      let writeCount = 0
      mocks.writeAvdConfigRaw.mockImplementation(async () => {
        writeCount += 1
        if (writeCount > 1) throw new Error('回滚也失败')
      })
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('冻结')
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ lastError?: { code: string } }>
      }
      expect(list.devices[0]!.lastError?.code).toBe('config-transaction')
      const fingerprint2 = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { fingerprint: string; saveBlockedReason: string | null }
      expect(fingerprint2.saveBlockedReason).toContain('冻结')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fingerprint2.fingerprint,
          name: '再试'
        })
      ).rejects.toThrow('冻结')
    })

    it('复查 P2-3：共绑摄像头不再阻断保存；草稿提示同时运行回退语义（只改 RAM 可过）', async () => {
      // 目标自身占 webcam0；另一台设备也占 webcam0（同宿主身份），另占 webcam1
      mocks.listWebcams.mockResolvedValue([
        { id: 'webcam0', deviceLabel: 'FaceTime HD' },
        { id: 'webcam1', deviceLabel: '外接相机' }
      ])
      const occupiedDevice = editDevice({
        id: OTHER_ID,
        name: '占用机',
        advancedSettings: editSettings({
          frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' }
        })
      })
      const selfWebcam = editDevice({
        advancedSettings: editSettings({
          frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' }
        })
      })
      mocks.readDeviceMetas.mockResolvedValue([selfWebcam as never, occupiedDevice as never])
      const { handlerFor } = await freshDomain()
      // 草稿：共享的前置摄像头带非阻断提示（说明回退语义，不阻断保存）
      const snapshot = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { fieldNotes: Record<string, { warning: string | null }>; fingerprint: string }
      expect(snapshot.fieldNotes.frontCamera?.warning).toContain('同时绑定在设备「占用机」')
      expect(snapshot.fieldNotes.rearCamera?.warning).toBeNull()
      // 想选另一台设备已占的 webcam1：设计决定后允许保存（启动时仲裁裁决）
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: snapshot.fingerprint,
          advancedSettings: { rearCamera: { mode: 'webcam', deviceId: 'webcam1' } }
        })
      ).resolves.toBeTruthy()
      // 自身已占 webcam0 未变更：只改 RAM 不误判
      const fp2 = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp2,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
    })

    it('stale webcam 未修改不阻断 RAM 编辑；新选择失效摄像头仍拒绝', async () => {
      // 相机与配置一致时仍保留旧资源；本轮只显式同步有偏差的字段。
      mocks.readAvdConfigRaw.mockResolvedValue(
        CONFIG_RAW.replace('hw.camera.front=emulated', 'hw.camera.front=webcam9')
      )
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({
          advancedSettings: editSettings({
            frontCamera: { mode: 'webcam', deviceId: 'webcam9' }
          })
        }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      expect(mocks.writeDeviceMetas.mock.calls.at(-1)![0][0].advancedSettings?.frontCamera).toEqual(
        { mode: 'webcam', deviceId: 'webcam9' }
      )
      const nextFp = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: nextFp,
          advancedSettings: { rearCamera: { mode: 'webcam', deviceId: 'webcam9' } }
        })
      ).rejects.toThrow('已不可用')
    })

    it('相机偏差即使表单未改，保存仍复验资源；失效时不写配置', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice({
          advancedSettings: editSettings({
            frontCamera: { mode: 'webcam', deviceId: 'webcam9' }
          })
        }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint
        })
      ).rejects.toThrow('已不可用')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
      expect(mocks.writeDeviceMetas).not.toHaveBeenCalled()
    })

    it('未知 legacy 草稿不填默认容量，拒绝附加编辑但允许改名', async () => {
      mocks.readDeviceMetas.mockResolvedValue([editDevice({ advancedSettings: null }) as never])
      mocks.readAvdConfigRaw.mockResolvedValue('hw.cpu.ncore=0\n')
      const { handlerFor } = await freshDomain()
      const snap = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: DEVICE_ID
      })) as { settings: unknown; internalStorage: { valueMiB: unknown }; fingerprint: string }
      expect(snap.settings).toBeNull()
      expect(snap.internalStorage.valueMiB).toBeNull()
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: snap.fingerprint,
          advancedSettings: { networkSpeed: 'lte' }
        })
      ).rejects.toThrow('仅支持修改名称')
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint: snap.fingerprint,
        name: '旧机改名'
      })
      expect(mocks.writeDeviceMetas.mock.calls.at(-1)![0][0].advancedSettings).toBeNull()
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('legacy 仅改网络仍保持 GPU host，原 config auto 不被重写', async () => {
      mocks.readDeviceMetas.mockResolvedValue([editDevice({ advancedSettings: null }) as never])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        advancedSettings: { networkSpeed: 'lte' }
      })
      const saved = mocks.writeDeviceMetas.mock.calls.at(-1)![0][0].advancedSettings!
      expect(saved.graphics).toBe('host')
      const { settingsToRunnerArgs } = await import('@shared/settings-contract')
      expect(settingsToRunnerArgs(saved)).toEqual(
        expect.arrayContaining(['-gpu', 'host', '-netspeed', 'lte'])
      )
      expect(mocks.writeAvdConfigRaw.mock.calls.at(-1)![2]).toBe(CONFIG_RAW)
    })

    it('提交成功后清理失败仍成功广播；旧 journal 未清理前不得覆盖', async () => {
      mocks.removeJournal.mockRejectedValue(new Error('清理失败'))
      const send = vi.fn()
      mocks.getAllWindows.mockReturnValue([{ webContents: { send } }])
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      expect(send).toHaveBeenCalledWith(
        IPC_CHANNELS.devicesChanged,
        expect.objectContaining({
          devices: expect.arrayContaining([
            expect.objectContaining({ advancedSettings: expect.objectContaining({ ramMiB: 4096 }) })
          ])
        })
      )
      mocks.readAvdConfigRaw.mockResolvedValue(CONFIG_RAW.replace('2048', '4096'))
      const nextFp = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: nextFp,
          advancedSettings: { ramMiB: 8192 }
        })
      ).rejects.toThrow('清理失败')
      expect(mocks.writeJournal).toHaveBeenCalledTimes(1)
    })

    it('复查 P2-2：清理失败的残留记录在仅改名前重试清理，改名成功落盘', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      // 第一次保存成功但 journal 清理失败（一次性失败，重试可成功）
      mocks.removeJournal.mockRejectedValueOnce(new Error('清理失败'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      const cleanupCalls = mocks.removeJournal.mock.calls.length
      // 仅改名（走 commitMetas）：先重试清理成功，改名落盘
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
          id: DEVICE_ID,
          name: '清理后改名'
        })
      ).resolves.toBeTruthy()
      expect(mocks.removeJournal.mock.calls.length).toBeGreaterThan(cleanupCalls)
      expect(mocks.fileMetas.current![0]).toMatchObject({ id: DEVICE_ID, name: '清理后改名' })
    })

    it('复查 P2-2：清理持续失败时仅改名被中止，devices.json 不变（重启不误冻结）', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      mocks.removeJournal.mockRejectedValue(new Error('清理失败'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), {
          id: DEVICE_ID,
          name: '不该成功'
        })
      ).rejects.toThrow('未清理的配置事务记录')
      expect(mocks.fileMetas.current![0]).toMatchObject({ id: DEVICE_ID, name: '编辑机' })
    })

    it('保存前即时健康异常拒绝写入，旧扫描 valid 不能绕过', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      mocks.checkDeviceHealth.mockResolvedValue({
        state: 'unsafe',
        issues: [{ component: 'avd', code: 'symlink', severity: 'error', message: '目录已被替换' }],
        checkedAt: 1
      })
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('目录已被替换')
      expect(mocks.writeJournal).not.toHaveBeenCalled()
    })

    it('复查设计决定：跨设备编辑与创建可共绑同一摄像头；提交失败不残留阻断', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        editDevice() as never,
        editDevice({ id: OTHER_ID }) as never
      ])
      const { handlerFor } = await freshDomain()
      const fp1 = await fingerprintOfSnapshot(handlerFor)
      mocks.wizardContext.current = { kind: 'edit', deviceId: OTHER_ID }
      const snap2 = (await handlerFor(IPC_CHANNELS.devicesReadConfig)(editEvent(), {
        id: OTHER_ID
      })) as { fingerprint: string }
      mocks.wizardContext.current = { kind: 'edit', deviceId: DEVICE_ID }
      // 两台设备先后选择同一摄像头：均保存成功（启动仲裁才裁决占用）
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp1,
          advancedSettings: { frontCamera: { mode: 'webcam', deviceId: 'webcam0' } }
        })
      ).resolves.toBeTruthy()
      mocks.wizardContext.current = { kind: 'edit', deviceId: OTHER_ID }
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: OTHER_ID,
          fingerprint: snap2.fingerprint,
          advancedSettings: { frontCamera: { mode: 'webcam', deviceId: 'webcam0' } }
        })
      ).resolves.toBeTruthy()
      mocks.wizardContext.current = { kind: 'edit', deviceId: DEVICE_ID }
      // 创建同样可共绑
      await expect(
        handlerFor(IPC_CHANNELS.devicesCreate)(mainWindowEvent(), {
          ...validCreateInput,
          advancedSettings: editSettings({ frontCamera: { mode: 'webcam', deviceId: 'webcam0' } })
        })
      ).resolves.toBeTruthy()
      // 提交失败（盘满）后重试成功——没有残留的预留阻断
      const fp2 = await fingerprintOfSnapshot(handlerFor)
      mocks.writeDeviceMetas.mockRejectedValueOnce(new Error('盘满'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp2,
          advancedSettings: { ramMiB: 4096 }
        })
      ).rejects.toThrow('盘满')
      const fp3 = await fingerprintOfSnapshot(handlerFor)
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: fp3,
          advancedSettings: { ramMiB: 4096 }
        })
      ).resolves.toBeTruthy()
    })

    it('明确挖孔恢复只记录目标请求，下次启动成功后才清除；普通启动不修改用户挖孔', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      await handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        resetDisplayCutout: true
      })
      expect(mocks.writeDeviceMetas.mock.calls.at(-1)![0][0]).toMatchObject({
        cutoutResetPending: true,
        snapshotReadyAt: null
      })
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
      expect(mocks.resetDisplayCutout).not.toHaveBeenCalled()
      startThroughPreflight()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      const args = mocks.createRunner.mock.calls.at(-1)![0] as {
        afterBoot: (id: string, runId: string, serial: string, signal: AbortSignal) => Promise<void>
      }
      const runId = 'run-1' // startThroughPreflight 返回的实际启动代次
      mocks.resetDisplayCutout.mockRejectedValueOnce(new Error('重启失败'))
      await expect(
        args.afterBoot(DEVICE_ID, runId, 'emulator-5556', new AbortController().signal)
      ).rejects.toThrow('重启失败')
      expect(mocks.fileMetas.current![0].cutoutResetPending).toBe(true)
      await args.afterBoot(DEVICE_ID, runId, 'emulator-5556', new AbortController().signal)
      expect(mocks.fileMetas.current![0].cutoutResetPending).toBeUndefined()
      const count = mocks.resetDisplayCutout.mock.calls.length
      await args.afterBoot(DEVICE_ID, runId, 'emulator-5556', new AbortController().signal)
      expect(mocks.resetDisplayCutout).toHaveBeenCalledTimes(count)
    })

    it('编辑窗不能发起创建（create/edit 隔离）', async () => {
      const { handlerFor } = await freshDomain()
      await expect(
        handlerFor(IPC_CHANNELS.devicesCreate)(editEvent(), validCreateInput)
      ).rejects.toThrow('未登记的窗口')
    })

    it('保存进行中：启动/删除/独立重命名拒绝同设备交错', async () => {
      const { handlerFor } = await freshDomain()
      const fingerprint = await fingerprintOfSnapshot(handlerFor)
      let releaseConfigRead!: (value: string | null) => void
      let hang = true
      mocks.readAvdConfigRaw.mockImplementation(async () => {
        if (!hang) return CONFIG_RAW
        return await new Promise<string | null>((resolve) => {
          releaseConfigRead = resolve
        })
      })
      const saving = handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
        id: DEVICE_ID,
        fingerprint,
        name: '改名'
      })
      await vi.waitFor(() => expect(typeof releaseConfigRead).toBe('function'))
      await expect(
        handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('正在保存配置')
      await expect(
        handlerFor(IPC_CHANNELS.devicesDelete)(mainWindowEvent(), { id: DEVICE_ID })
      ).rejects.toThrow('正在保存配置')
      await expect(
        handlerFor(IPC_CHANNELS.devicesRename)(mainWindowEvent(), { id: DEVICE_ID, name: '别改' })
      ).rejects.toThrow('正在保存配置')
      hang = false
      releaseConfigRead(CONFIG_RAW)
      await expect(saving).resolves.toBeTruthy()
    })
  })

  describe('摄像头启动仲裁（设计决定 2026-10-09）', () => {
    const EARLY_ID = '018f1c2d-aaaa-4000-8000-000000000001'
    const LATE_ID = '018f1c2d-bbbb-4000-8000-000000000002'
    const configWithCamera = (front: string): string =>
      [
        'avd.ini.encoding=UTF-8',
        'hw.ramSize=2048',
        'hw.cpu.ncore=4',
        'vm.heapSize=256',
        'hw.gpu.mode=auto',
        `hw.camera.front=${front}`,
        'hw.camera.back=emulated',
        'disk.dataPartition.size=6144M',
        ''
      ].join('\n')

    const deviceMeta = (
      id: string,
      name: string,
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> => ({
      id,
      name,
      profileId: 'pixel_8',
      profileLabel: 'Pixel 8',
      imagePackageName: 'system-images;android-36;google_apis_playstore;arm64-v8a',
      apiDisplay: '36',
      formFactor: 'phone',
      screenSummary: null,
      advancedSettings: {
        skinRef: null,
        frontCamera: { mode: 'webcam', deviceId: 'webcam0', hostDeviceId: 'FaceTime HD' },
        rearCamera: { mode: 'emulated', deviceId: null },
        networkSpeed: null,
        networkLatency: null,
        orientation: null,
        bootMode: 'cold',
        internalStorageMiB: 6144,
        cpuCores: 4,
        graphics: 'auto',
        ramMiB: 2048,
        vmHeapMiB: 256,
        preferredAbi: 'optimal'
      },
      snapshotReadyAt: null,
      createdAt: 0,
      ...overrides
    })

    /** runner 配置接缝：extraArgsFor 在 spawn 时被调用 */
    const extraArgsFor = (id: string): string[] => {
      const config = mocks.createRunner.mock.calls.at(-1)![0] as {
        extraArgsFor?: (id: string) => string[]
      }
      return config.extraArgsFor?.(id) ?? []
    }

    /** 驱动 beforeStart 并回显传入 runId：仲裁覆盖按 runId 隔离，行内代次要一致 */
    const startEchoingRunId = (): void => {
      mocks.runnerInstance.start.mockImplementation(
        async (id: string, runId: string): Promise<{ runId: string; serial: string }> => {
          const config = mocks.createRunner.mock.calls.at(-1)![0] as {
            beforeStart?: (id: string, runId: string, signal: AbortSignal) => Promise<void>
          }
          await config.beforeStart?.(id, runId, new AbortController().signal)
          return { runId, serial: 'emulator-5554' }
        }
      )
    }

    /** 行内当前 runId（回显后 = 启动代次） */
    const runIdOf = async (
      handlerFor: (channel: string) => (event: unknown, raw: unknown) => Promise<unknown>,
      id: string
    ): Promise<string | undefined> => {
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; runId?: string }>
      }
      return list.devices.find((device) => device.id === id)?.runId
    }

    beforeEach(() => {
      vi.clearAllMocks()
      mocks.checkDeviceHealth.mockResolvedValue({ state: 'valid', issues: [], checkedAt: 42 })
      mocks.writeDeviceMetas.mockImplementation(async (metas: DeviceMeta[]) => {
        mocks.fileMetas.current = metas
      })
      mocks.getAllWindows.mockReturnValue([])
      mocks.getMainWindow.mockReturnValue({ webContents: { id: 7, send: vi.fn() } })
      mocks.writeAvdConfigRaw.mockResolvedValue(undefined)
      mocks.readHardwareSchemaDefaults.mockResolvedValue({})
      mocks.recoverPendingTransactions.mockResolvedValue({
        completed: [],
        rolledBack: [],
        frozen: []
      })
      mocks.listWebcams.mockResolvedValue([{ id: 'webcam0', deviceLabel: 'FaceTime HD' }])
      mocks.runnerInstance.start.mockResolvedValue({ runId: 'run-1', serial: 'emulator-5554' })
      mocks.runnerInstance.stop.mockResolvedValue(undefined)
      startEchoingRunId()
    })

    it('先到先得：运行中的先启动方保住摄像头，后启动方回退模拟画面并透出行内通知', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机') as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async (name: string) =>
        name === EARLY_ID ? configWithCamera('webcam0') : configWithCamera('webcam0')
      )
      const { handlerFor, runnerEvents } = await freshDomain()
      // 先启机启动并进入运行
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      // 后启机启动：仲裁命中同一宿主摄像头
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).toEqual(expect.arrayContaining(['-camera-front', 'emulated']))
      expect(extraArgsFor(EARLY_ID)).not.toContain('emulated')
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; cameraNotice?: string }>
      }
      const late = list.devices.find((device) => device.id === LATE_ID)
      const early = list.devices.find((device) => device.id === EARLY_ID)
      expect(late?.cameraNotice).toContain('前置摄像头')
      expect(late?.cameraNotice).toContain('先启机')
      expect(late?.cameraNotice).toContain('模拟画面')
      expect(early?.cameraNotice).toBeUndefined()
    })

    it('托管设置的既有 -camera-front 参数被替换为 emulated（不改 config.ini）', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机') as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam0'))
      // 与真实契约一致：托管设置会输出 -camera-front webcam0（once——不泄漏到后续用例）
      mocks.settingsToRunnerArgs.mockImplementationOnce(() => [
        '-camera-front',
        'webcam0',
        '-no-snapshot',
        '-gpu',
        'host'
      ])
      const { handlerFor, runnerEvents } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      const args = extraArgsFor(LATE_ID)
      const flagIndex = args.indexOf('-camera-front')
      expect(flagIndex).toBeGreaterThanOrEqual(0)
      expect(args[flagIndex + 1]).toBe('emulated')
      expect(args).not.toContain('webcam0')
      expect(mocks.writeAvdConfigRaw).not.toHaveBeenCalled()
    })

    it('legacy 设备同样参与仲裁：无既有 camera 参数时追加回退参数', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机', { advancedSettings: null }) as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam0'))
      const { handlerFor, runnerEvents } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).toEqual(expect.arrayContaining(['-camera-front', 'emulated']))
      // legacy 设备的 config.ini 绑定是仲裁数据源（复查 P2-3：旧设备绑定计入）
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; cameraNotice?: string }>
      }
      expect(list.devices.find((device) => device.id === LATE_ID)?.cameraNotice).toContain(
        '模拟画面'
      )
    })

    it('legacy 死绑定：枚举成功但资源号已消失 → 回退模拟画面并说明', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(LATE_ID, '旧绑定机', { advancedSettings: null }) as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam9'))
      const { handlerFor } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).toEqual(expect.arrayContaining(['-camera-front', 'emulated']))
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ cameraNotice?: string }>
      }
      expect(list.devices[0]?.cameraNotice).toContain('webcam9')
      expect(list.devices[0]?.cameraNotice).toContain('已不可用')
    })

    it('对端停止后重启：恢复真实摄像头，通知清除', async () => {
      mocks.readDeviceMetas.mockResolvedValue([
        deviceMeta(EARLY_ID, '先启机') as never,
        deviceMeta(LATE_ID, '后启机') as never
      ])
      mocks.readAvdConfigRaw.mockImplementation(async () => configWithCamera('webcam0'))
      const { handlerFor, runnerEvents } = await freshDomain()
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: EARLY_ID })
      runnerEvents().onRunning(EARLY_ID, (await runIdOf(handlerFor, EARLY_ID))!, 'emulator-5554')
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      runnerEvents().onRunning(LATE_ID, (await runIdOf(handlerFor, LATE_ID))!, 'emulator-5556')
      expect(extraArgsFor(LATE_ID)).toContain('emulated')
      // 两台都停止后重启后启机：无占用，真实摄像头恢复
      await handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), { id: LATE_ID })
      await handlerFor(IPC_CHANNELS.devicesStop)(mainWindowEvent(), { id: EARLY_ID })
      await handlerFor(IPC_CHANNELS.devicesStart)(mainWindowEvent(), { id: LATE_ID })
      expect(extraArgsFor(LATE_ID)).not.toContain('emulated')
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ id: string; cameraNotice?: string }>
      }
      expect(list.devices.find((device) => device.id === LATE_ID)?.cameraNotice).toBeUndefined()
    })
  })

  describe('首载恢复（冻结目标落到行内）', () => {
    it('恢复冻结的设备：lastError= config-transaction 且保存被拒', async () => {
      mocks.recoverPendingTransactions.mockResolvedValue({
        completed: [],
        rolledBack: [],
        frozen: [{ deviceId: DEVICE_ID, message: '上次保存未完成，已冻结' }]
      })
      const { handlerFor } = await freshDomain()
      const list = (await handlerFor(IPC_CHANNELS.devicesList)(mainWindowEvent(), undefined)) as {
        devices: Array<{ lastError?: { code: string; message: string } }>
      }
      expect(list.devices[0]!.lastError?.code).toBe('config-transaction')
      expect(list.devices[0]!.lastError?.message).toBe('上次保存未完成，已冻结')
      await expect(
        handlerFor(IPC_CHANNELS.devicesUpdateConfig)(editEvent(), {
          id: DEVICE_ID,
          fingerprint: 'fp',
          name: '改名'
        })
      ).rejects.toThrow('已冻结')
    })
  })
})
