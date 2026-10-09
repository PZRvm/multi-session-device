import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CameraSnapshot, WizardCapabilities } from '@shared/types'
import { messageOf } from './shared'

/**
 * 创建/编辑共用的皮肤与摄像头资源域（plan 2026-10-08 设计 4）：清单装载、
 * 导入/下载动作、摄像头权限枚举与错误。各自上下文持有草稿，这里只维护枚举
 * 状态；响应按调用方的代次守卫接纳，迟到结果不覆盖新草稿。资源刷新只更新
 * 枚举与错误，绝不重置草稿。
 */

export interface WizardResourceOverlay {
  /** 导入/下载成功并入的皮肤 id（补进能力的 skinIds，字段解锁） */
  addedSkinIds: string[]
  /** 最近一次摄像头枚举快照（覆盖能力里的 cameraSnapshot/webcamDeviceIds） */
  cameraSnapshot: CameraSnapshot | null
}

export interface WizardResources {
  skins: Array<{ skinRef: string; name: string; source: string }>
  skinError: string | null
  skinDownloading: string | null
  cameraBusy: boolean
  cameraError: string | null
  overlay: WizardResourceOverlay
  reloadSkins: () => Promise<void>
  importSkin: () => Promise<void>
  downloadSkinByName: (skinName: string) => Promise<void>
  cameraAction: (action: 'request' | 'refresh' | 'settings') => Promise<void>
  /** 覆盖层并入基础能力（新增皮肤枚举 + 摄像头快照）；入参 null 原样返回 */
  mergeOverlay: (capabilities: WizardCapabilities | null) => WizardCapabilities | null
}

export const useWizardResources = (opts: {
  /** 读调用方当前代次（能力上下文代次）；动作发起时的代次不一致即丢弃响应 */
  currentGeneration: () => number
  /** 导入/下载成功后回调——调用方把选中写进自己的草稿 */
  onSkinAdded: (skinRef: string) => void
  /** 注入场景（测试）跳过真实清单拉取 */
  disabled?: boolean
}): WizardResources => {
  const [skins, setSkins] = useState<Array<{ skinRef: string; name: string; source: string }>>([])
  const [skinError, setSkinError] = useState<string | null>(null)
  const [skinDownloading, setSkinDownloading] = useState<string | null>(null)
  const [cameraBusy, setCameraBusy] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<WizardResourceOverlay>({
    addedSkinIds: [],
    cameraSnapshot: null
  })
  const skinBusyRef = useRef(false)
  // 回调经 ref 透传（调用方重渲染换新闭包，动作函数保持稳定引用）；
  // 渲染期不写 ref（react-hooks/refs），提交后同步
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const reloadSkins = useCallback(async (): Promise<void> => {
    try {
      const list = optsRef.current.disabled
        ? [] // 注入场景（测试）不拉真实皮肤清单
        : await window.api.sdk.deviceSkins()
      setSkins(
        list.map((skin) => ({ skinRef: skin.skinRef, name: skin.name, source: skin.source }))
      )
    } catch {
      setSkins([])
    }
  }, [])

  useEffect(() => {
    return () => {
      skinBusyRef.current = false
    }
  }, [])

  const absorbSkin = (skinRef: string): void => {
    setOverlay((prev) =>
      prev.addedSkinIds.includes(skinRef)
        ? prev
        : { ...prev, addedSkinIds: [...prev.addedSkinIds, skinRef] }
    )
    optsRef.current.onSkinAdded(skinRef)
  }

  const importSkin = useCallback(async (): Promise<void> => {
    if (skinBusyRef.current) return
    skinBusyRef.current = true
    const generation = optsRef.current.currentGeneration()
    setSkinDownloading('导入')
    setSkinError(null)
    try {
      const added = await window.api.sdk.chooseDeviceSkin()
      // 用户取消选择器：null 哨兵静默早退，不当失败呈现
      if (added === null) return
      await reloadSkins()
      if (generation !== optsRef.current.currentGeneration()) return
      absorbSkin(added.skinRef)
    } catch (error) {
      if (generation === optsRef.current.currentGeneration()) setSkinError(messageOf(error))
    } finally {
      skinBusyRef.current = false
      setSkinDownloading(null)
    }
  }, [reloadSkins])

  const downloadSkinByName = useCallback(
    async (skinName: string): Promise<void> => {
      if (skinBusyRef.current) return
      skinBusyRef.current = true
      const generation = optsRef.current.currentGeneration()
      setSkinDownloading(skinName)
      setSkinError(null)
      try {
        const added = await window.api.sdk.downloadDeviceSkin(skinName)
        // 同意框取消：null 哨兵静默早退，不当失败呈现
        if (added === null) return
        await reloadSkins()
        if (generation !== optsRef.current.currentGeneration()) return
        absorbSkin(added.skinRef)
      } catch (error) {
        if (generation === optsRef.current.currentGeneration()) setSkinError(messageOf(error))
      } finally {
        skinBusyRef.current = false
        setSkinDownloading(null)
      }
    },
    [reloadSkins]
  )

  const cameraBusyPending = useRef(false)
  const cameraAction = useCallback(
    async (action: 'request' | 'refresh' | 'settings'): Promise<void> => {
      if (cameraBusyPending.current) return
      cameraBusyPending.current = true
      const generation = optsRef.current.currentGeneration()
      setCameraBusy(true)
      setCameraError(null)
      try {
        if (action === 'settings') {
          await window.api.sdk.cameraSettings()
          return
        }
        const snapshot = await window.api.sdk.cameraAccess(action === 'request')
        if (generation !== optsRef.current.currentGeneration()) return
        setOverlay((prev) => ({ ...prev, cameraSnapshot: snapshot }))
      } catch (error) {
        if (generation === optsRef.current.currentGeneration()) setCameraError(messageOf(error))
      } finally {
        cameraBusyPending.current = false
        setCameraBusy(false)
      }
    },
    []
  )

  const mergeOverlay = useCallback(
    (capabilities: WizardCapabilities | null): WizardCapabilities | null => {
      if (capabilities === null) return null
      const skinIds = [...capabilities.skinIds]
      for (const id of overlay.addedSkinIds) {
        if (!skinIds.includes(id)) skinIds.push(id)
      }
      const snapshot = overlay.cameraSnapshot
      return {
        ...capabilities,
        skinIds,
        fields: {
          ...capabilities.fields,
          skinRef:
            skinIds.length > 0
              ? { disabledReason: null, min: null, max: null, step: null }
              : capabilities.fields.skinRef
        },
        ...(snapshot !== null
          ? {
              cameraSnapshot: snapshot,
              webcamDeviceIds: snapshot.devices.map((camera) => camera.id)
            }
          : {})
      }
    },
    [overlay]
  )

  // 返回对象按状态收敛：调用方把 resources 放进 effect/useMemo 依赖时，只在
  // 枚举/错误真正变化时重建引用（动作函数本身都是稳定引用）
  return useMemo(
    () => ({
      skins,
      skinError,
      skinDownloading,
      cameraBusy,
      cameraError,
      overlay,
      reloadSkins,
      importSkin,
      downloadSkinByName,
      cameraAction,
      mergeOverlay
    }),
    [
      skins,
      skinError,
      skinDownloading,
      cameraBusy,
      cameraError,
      overlay,
      reloadSkins,
      importSkin,
      downloadSkinByName,
      cameraAction,
      mergeOverlay
    ]
  )
}
