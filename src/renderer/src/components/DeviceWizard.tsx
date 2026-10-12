import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import styled from 'styled-components'
import type {
  CreateDeviceInput,
  DeviceAdvancedSettings,
  DeviceFormFactor,
  DeviceProfile,
  ImageEntry,
  WizardCapabilities,
  SdkSourceMode
} from '@shared/types'
import { WIZARD_COPY, format } from '@shared/i18n'
import { assessImageCompatibility, profileHasSupportedImage } from '@shared/compatibility'
import { normalizeAdvancedSettings } from '@shared/settings-contract'
import Button from './Button'
import Input from './Input'
import ProfilePage from './wizard/ProfilePage'
import ImageTable, { type ImageFilters } from './wizard/ImageTable'
import SummaryPanel from './wizard/SummaryPanel'
import SettingsForm from './wizard/SettingsForm'
import { useWizardResources } from './wizard/useWizardResources'
import { useCopy } from '../hooks/useCopy'
import { useLocaleStore } from '../stores/localeStore'
import { apiDisplay, formatSize, messageOf, serviceLabel } from './wizard/shared'

/**
 * 两页向导（plan 2026-10-05-emulator-wizard 设计 3）：
 * 第 1 页选画像（六类导航 + 搜索 + 表格），第 2 页配置设备（设备/附加设置
 * 标签 + 镜像筛选表格 + 右侧固定摘要）。清单装载/下载/创建守卫沿用
 * 清单加载反馈（plan 2026-10-05-wizard-catalog-loading）的代次与防连击设计。
 */

export interface DeviceWizardData {
  profiles: DeviceProfile[]
  images: ImageEntry[]
}

/** 单份清单资源的装载状态；idle 只存在于首次请求发起前，UI 按 loading 对待 */
type ResourcePhase = 'idle' | 'loading' | 'ready' | 'error'

interface ResourceState<T> {
  phase: ResourcePhase
  data: T[]
  error: string | null
}

/**
 * 一份清单资源的装载器：首载与重试共用 reload。请求代次 + 组件存活双守卫，
 * 只接纳当前代次——关闭、取消或新请求发起后，迟到响应不再改变界面（此处
 * 只是忽略结果，不宣称取消了 main 侧的 Java/网络任务）。失败保留旧数据，
 * 停在错误态等待重试，不落进成功空态。
 */
const useCatalogResource = <T,>(
  fetcher: () => Promise<T[]>,
  initial: T[] | undefined
): { resource: ResourceState<T>; reload: () => Promise<void> } => {
  const [state, setState] = useState<ResourceState<T>>({
    phase: initial === undefined ? 'loading' : 'ready',
    data: initial ?? [],
    error: null
  })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const generationRef = useRef(0)
  const aliveRef = useRef(true)

  const reload = useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current
    setState((prev) => ({ ...prev, phase: 'loading', error: null }))
    try {
      const data = await fetcherRef.current()
      if (!aliveRef.current || generation !== generationRef.current) return
      setState({ phase: 'ready', data, error: null })
    } catch (error) {
      if (!aliveRef.current || generation !== generationRef.current) return
      setState((prev) => ({ ...prev, phase: 'error', error: messageOf(error) }))
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  return { resource: state, reload }
}

/** 清单拉取（注入场景跳过——测试直接给数据） */
const fetchProfiles = async (): Promise<DeviceProfile[]> => {
  if (typeof window === 'undefined' || !window.api?.sdk) {
    throw new Error(WIZARD_COPY[useLocaleStore.getState().locale].sdkApiUnavailable)
  }
  return window.api.sdk.profiles()
}

type WizardTab = 'device' | 'settings'

type DeviceWizardProps = {
  /** 返回 promise 时按钮进入创建中禁用态（防连击，issue 2026-10-04-wizard-create-no-double-click-guard） */
  onCreate: (input: CreateDeviceInput) => void | Promise<void>
  onCancel: () => void
  /** 数据注入（测试用）；缺省从 window.api.sdk 拉取 */
  data?: DeviceWizardData
  /** 下载触发注入（测试用）；缺省走 sdk.downloadImage */
  onDownloadImage?: (packageName: string) => Promise<void>
  /** 能力查询注入（测试用）；缺省走 sdk.wizardCapabilities */
  onWizardCapabilities?: (
    profileId: string,
    imagePackageName: string
  ) => Promise<WizardCapabilities>
  /** 卸载触发注入（测试用）；缺省走 sdk.uninstallImage（原生确认框在组件内弹） */
  onUninstallImage?: (packageName: string) => Promise<void>
}

const DeviceWizard = ({
  onCreate,
  onCancel,
  data,
  onDownloadImage,
  onWizardCapabilities,
  onUninstallImage
}: DeviceWizardProps): React.JSX.Element => {
  const copy = useCopy(WIZARD_COPY)
  const locale = useLocaleStore((state) => state.locale)
  const [page, setPage] = useState<1 | 2>(1)
  // 画像页筛选
  const [category, setCategory] = useState<DeviceFormFactor>('phone')
  const [search, setSearch] = useState('')
  // 官方源暂无弃用信号——开关禁用中，恒为 false；信号源接入时恢复 setState 接线
  const [showDeprecated] = useState(false)
  // 配置页
  const [tab, setTab] = useState<WizardTab>('device')
  // SDK 来源（镜像清单响应附带，plan 2026-10-12 共享态收窄的分支依据）
  const [sdkSource, setSdkSource] = useState<SdkSourceMode | null>(null)
  const [imageFilters, setImageFilters] = useState<ImageFilters>({
    service: 'all',
    showFullList: false,
    showPreview: false,
    showUnsupported: false
  })

  const [profile, setProfile] = useState<DeviceProfile | null>(null)
  const [image, setImage] = useState<ImageEntry | null>(null)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  // 防连击的同步守卫：React 状态在同一 tick 内不刷新（冒烟实测连点两击同毫秒建了
  // 两台设备），ref 跨越批处理时序立即可见——disabled 与 state 只是视觉层
  const creatingRef = useRef(false)

  const { resource: profiles, reload: reloadProfiles } = useCatalogResource<DeviceProfile>(
    fetchProfiles,
    data?.profiles
  )
  // SDK 引导入口（用户 2026-10-12 需求：清除保留 SDK 后切回托管，根已空要能重建）：
  // 画像清单报「SDK 尚未就绪」时探测组件状态，JRE/cmdline-tools 缺失 → 错误块出现
  // 「完成 SDK 引导」按钮，成功后自动重拉清单。bootstrap 通道（sdk:bootstrap）一直
  // 在，此前无 UI 消费——原 plan「空根起步 + 向导 bootstrap」至此闭环
  const [sdkBootstrapable, setSdkBootstrapable] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  useEffect(() => {
    if (profiles.error === null || sdkBootstrapable || bootstrapping) return
    let alive = true
    void (async () => {
      try {
        const snapshot = await window.api?.sdk?.status()
        if (
          alive &&
          snapshot !== undefined &&
          (!snapshot.cmdlineTools.present || !snapshot.jre.present)
        ) {
          setSdkBootstrapable(true)
        }
      } catch {
        // 探测失败保持纯重试——引导按钮宁缺毋滥
      }
    })()
    return () => {
      alive = false
    }
  }, [profiles.error, sdkBootstrapable, bootstrapping])
  const runSdkBootstrap = useCallback(async (): Promise<void> => {
    if (bootstrapping) return
    setBootstrapping(true)
    setBootstrapError(null)
    try {
      await window.api?.sdk?.bootstrap()
      setSdkBootstrapable(false)
      void reloadProfiles()
    } catch (error) {
      setBootstrapError(
        format(WIZARD_COPY[useLocaleStore.getState().locale].sdkBootstrapFailed, {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setBootstrapping(false)
    }
  }, [bootstrapping, reloadProfiles])
  // 重开恢复暂存（review P3：模块级可变量下沉为实例 ref；仍不入 state——
  // 绕过请求代次守卫的口径不变）
  const lastActiveRef = useRef<{
    download: { packageName: string; percent: number } | null
    uninstall: { packageName: string } | null
  }>({ download: null, uninstall: null })
  const fetchImagesViaApi = useCallback(async (): Promise<ImageEntry[]> => {
    if (typeof window === 'undefined' || !window.api?.sdk) {
      throw new Error(WIZARD_COPY[useLocaleStore.getState().locale].sdkApiUnavailable)
    }
    const catalog = await window.api.sdk.images()
    lastActiveRef.current = {
      download: catalog.activeDownload,
      uninstall: catalog.activeUninstall
    }
    // 来源标记（plan 2026-10-12）：main 按 sdk.json 填充；未填（旧桩/注入数据）按非共享
    if (catalog.sdkSource !== undefined) setSdkSource(catalog.sdkSource)
    return catalog.images
  }, [])
  const { resource: images, reload: reloadImages } = useCatalogResource<ImageEntry>(
    fetchImagesViaApi,
    data?.images
  )

  // 下载状态独立于清单装载：包名 + 百分比；不与 loading 合并
  const [downloading, setDownloading] = useState<{ packageName: string; percent: number } | null>(
    null
  )
  const [downloadError, setDownloadError] = useState<{
    message: string
    packageName: string
  } | null>(null)
  // 下载触发的同步守卫（口径同 creatingRef）：下载钮是 disabled 行内的 span，
  // jsdom/极端竞速能穿透行禁用，同 tick 连点只有 ref 拦得住
  const downloadingRef = useRef(false)

  // 重开恢复（plan 设计 3/9）：清单就绪且本地无下载状态时，从最近响应的
  // activeDownload 恢复后台任务进度。恢复即消费——不清 ref 会在失败事件清空
  // 状态后依赖重跑，把旧快照设回去（乒乓）；后续进度继续走事件订阅
  useEffect(() => {
    const pending = lastActiveRef.current.download
    if (images.phase === 'ready' && downloading === null && pending !== null) {
      lastActiveRef.current = { ...lastActiveRef.current, download: null }
      // 一次性恢复（记录已消费）——不构成级联渲染
      setDownloading({ ...pending })
    }
  }, [images.phase, downloading])

  // 设置能力（画像×镜像选定后拉取；代次守卫防陈旧覆盖）与用户设置值
  const [capabilities, setCapabilities] = useState<{
    phase: 'idle' | 'loading' | 'ready' | 'error'
    data: WizardCapabilities | null
    error: string | null
  }>({ phase: 'idle', data: null, error: null })
  const [advancedSettings, setAdvancedSettings] = useState<DeviceAdvancedSettings | null>(null)
  const capabilityGenerationRef = useRef(0)
  const skinChoicesRef = useRef(new Map<string, string | null>())
  // 镜像卸载（plan 2026-10-06-image-uninstall）：进行中的包名（该行 spinner、
  // 其余行禁用）+ 中文错误（main 守卫文案直接展示）
  const [uninstallingPackage, setUninstallingPackage] = useState<string | null>(null)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  // 卸载重开恢复（与下载恢复同口径）：main 同一时刻只有一个包操作，两个恢复互斥
  useEffect(() => {
    const pending = lastActiveRef.current.uninstall
    if (images.phase === 'ready' && uninstallingPackage === null && pending !== null) {
      lastActiveRef.current = { ...lastActiveRef.current, uninstall: null }
      setUninstallingPackage(pending.packageName)
    }
  }, [images.phase, uninstallingPackage])

  // 皮肤域：清单（导入/下载后刷新）、下载互斥与进度
  const profileRef = useRef<DeviceProfile | null>(null)
  // 供共用资源域回调取「当前画像」——渲染期不写 ref（react-hooks/refs），提交后同步
  useEffect(() => {
    profileRef.current = profile
  }, [profile])
  // 共用资源域（创建/编辑同源，plan 2026-10-08 设计 4）：枚举与错误在这里，
  // 草稿仍由本组件持有；资源刷新不重置草稿
  const resources = useWizardResources({
    currentGeneration: () => capabilityGenerationRef.current,
    onSkinAdded: (skinRef) => {
      if (profileRef.current !== null) skinChoicesRef.current.set(profileRef.current.id, skinRef)
      setAdvancedSettings((prev) => (prev === null ? prev : { ...prev, skinRef }))
    },
    disabled: data !== undefined
  })

  // 首载：无注入数据时两份清单并发发起，成功失败各自接住，互不拖住
  useEffect(() => {
    if (data) return
    void reloadProfiles()
    void reloadImages()
  }, [data, reloadProfiles, reloadImages])

  // 下载进度订阅：同包名写进度，完成后重拉清单（拿已装标记；已有数据 → 紧凑刷新
  // 反馈）；error 非空 = 后台任务失败广播（发起窗口可能已关）——显示错误并解锁
  useEffect(() => {
    if (data) return
    return window.api.sdk.onImageProgress((progress) => {
      if (progress.canceled === true) {
        // 取消不是失败：清下载态（无错误横幅）；本地发起端可能已先清——幂等
        setDownloading((current) =>
          current?.packageName === progress.packageName ? null : current
        )
        return
      }
      if (progress.error !== undefined) {
        setDownloading((current) =>
          current?.packageName === progress.packageName ? null : current
        )
        setDownloadError({ message: progress.error, packageName: progress.packageName })
        return
      }
      setDownloading({ packageName: progress.packageName, percent: progress.percent })
      if (progress.percent >= 100) {
        setDownloading(null)
        void reloadImages()
      }
    })
  }, [data, reloadImages])

  useEffect(() => {
    // 装载动作走 async——列表落位在 promise 回调，不在 effect 内同步 setState。
    // 依赖用稳定的 reloadSkins 引用而非 resources 对象（其随 skins 状态刷新换
    // 引用，入依赖会在 page 2 形成无限重拉循环）
    if (data === undefined && page === 2) {
      void (async () => {
        await resources.reloadSkins()
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloadSkins 是 useCallback([]) 稳定引用
  }, [data, page, resources.reloadSkins])

  // 卸载已装镜像：原生确认框列后果 → main 守卫链（引用/互斥拒绝文案直接展示）
  // → 成功后重拉清单（选中镜像若被删，选择核验派生自动清空）
  const uninstall = async (entry: ImageEntry): Promise<void> => {
    if (uninstallingPackage !== null) return
    if (typeof window.api?.dialog?.show === 'function') {
      // 确认框也会 reject（main 守卫拒绝，如迁移中）——与执行段同口径展示，
      // 不留 unhandled rejection（issue 2026-10-01-dialog-unhandled-rejection）
      let result: Awaited<ReturnType<typeof window.api.dialog.show>>
      try {
        result = await window.api.dialog.show({
          title: copy.uninstallImageTitle,
          message: format(copy.uninstallImageConfirm, {
            api: apiDisplay(entry),
            service: serviceLabel(entry)
          }),
          detail: format(copy.uninstallImageDetail, {
            packageName: entry.packageName,
            size: formatSize(entry.sizeBytes, copy)
          }),
          buttons: [copy.delete, copy.cancel],
          cancelId: 1
        })
      } catch (error) {
        setUninstallError(messageOf(error))
        return
      }
      if (result.response !== 0) return
    }
    setUninstallingPackage(entry.packageName)
    setUninstallError(null)
    try {
      if (onUninstallImage) await onUninstallImage(entry.packageName)
      else await window.api.sdk.uninstallImage(entry.packageName)
      // 完成后的清状态与重拉由 sdk:uninstall-state 订阅统一负责（发起窗口也收
      // 广播）；注入场景无订阅，与 download() 同口径不做真实重拉——避免双拉
    } catch (error) {
      setUninstallError(messageOf(error))
    } finally {
      setUninstallingPackage(null)
    }
  }

  // 导入/下载并入能力与摄像头刷新由共用资源域的 overlay 承担（useWizardResources）：
  // mergeOverlay 把新增 skinIds / 最新 cameraSnapshot 并入能力——能力 effect 只随
  // 画像×镜像重拉，资源扩容不重置草稿（review P2-1 口径不变）

  // 卸载终态订阅（重开向导由此解除恢复的卸载状态）：完成 → 清状态 + 重拉；
  // 失败 → 展示 main 文案。发起窗口自身也收（幂等：仅包名匹配时清理）
  useEffect(() => {
    if (data) return
    if (typeof window.api.sdk.onUninstallState !== 'function') return
    return window.api.sdk.onUninstallState((state) => {
      setUninstallingPackage((current) => (current === state.packageName ? null : current))
      if (state.error !== undefined) {
        setUninstallError(state.error)
        return
      }
      void reloadImages()
    })
  }, [data, reloadImages])

  const download = async (entry: ImageEntry): Promise<void> => {
    if (downloadingRef.current) return
    downloadingRef.current = true
    setDownloading({ packageName: entry.packageName, percent: 0 })
    setDownloadError(null)
    try {
      if (onDownloadImage) await onDownloadImage(entry.packageName)
      else await window.api.sdk.downloadImage(entry.packageName)
      // 完成后的重拉统一由 100% 进度广播触发（与卸载侧终态订阅同口径，
      // review P3 双拉去重——invoke resolve 路径不再重复拉清单）
    } catch (error) {
      setDownloadError({ message: messageOf(error), packageName: entry.packageName })
    } finally {
      downloadingRef.current = false
      setDownloading(null)
    }
  }

  // 显式取消（plan download-cancel）：invoke resolve = main 已收尾（临时物清理、
  // 互斥释放）——本地立即清状态；广播分支服务重开窗与迟到订阅者
  const cancelDownload = async (packageName: string): Promise<void> => {
    if (onDownloadImage) {
      // 注入场景（测试）无 main——本地直接模拟收尾完成
      setDownloading(null)
      return
    }
    await window.api.sdk.cancelDownloadImage(packageName)
    setDownloading((current) => (current?.packageName === packageName ? null : current))
  }

  const retryDownload = (): void => {
    const target = images.data.find((entry) => entry.packageName === downloadError?.packageName)
    if (target) void download(target)
    else setDownloadError(null)
  }

  // 核验选择仍在最新清单里（画像按 id、镜像按 packageName）：渲染期派生取最新条目，
  // 刷新后被移除或标记翻转的选择自动失效，推进与创建随选择失效
  const selectedProfile =
    profile === null ? null : (profiles.data.find((entry) => entry.id === profile.id) ?? null)
  const selectedImage =
    image === null
      ? null
      : (images.data.find((entry) => entry.packageName === image.packageName) ?? null)

  // 能力装载：画像×镜像都选定且清单就绪后发起；上下文（画像/镜像）变化即重拉，
  // 迟到结果按代次丢弃。拉到新能力后设置值重置为 defaults（不静默沿用已失效输入）
  useEffect(() => {
    // 装载状态机的同步重置/置 loading 与 useCatalogResource 同模式：状态由
    // effect 依赖驱动，重置不会级联（下一 render 依赖不再变化）
    const generation = ++capabilityGenerationRef.current
    if (selectedProfile === null || selectedImage === null) {
      // 依赖驱动的同步重置：下一 render 依赖不再变化，不构成级联渲染
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCapabilities({ phase: 'idle', data: null, error: null })
      setAdvancedSettings(null)
      return
    }
    setCapabilities((prev) => ({ ...prev, phase: 'loading', error: null }))
    const fetchCapabilities = async (): Promise<void> => {
      try {
        const result = onWizardCapabilities
          ? await onWizardCapabilities(selectedProfile.id, selectedImage.packageName)
          : await window.api.sdk.wizardCapabilities(selectedProfile.id, selectedImage.packageName)
        if (generation !== capabilityGenerationRef.current) return
        setCapabilities({ phase: 'ready', data: result, error: null })
        setAdvancedSettings({
          ...result.defaults,
          skinRef: skinChoicesRef.current.has(selectedProfile.id)
            ? skinChoicesRef.current.get(selectedProfile.id)!
            : result.defaults.skinRef
        })
      } catch (error) {
        if (generation !== capabilityGenerationRef.current) return
        setCapabilities({ phase: 'error', data: null, error: messageOf(error) })
      }
    }
    void fetchCapabilities()
    // selectedProfile/selectedImage 为渲染期派生的核验值，身份随清单刷新自动失效
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖收敛到 id/packageName：整对象入依赖会在清单刷新时把未变化的选择误判重拉
  }, [selectedProfile?.id, selectedImage?.packageName, onWizardCapabilities])

  // 逐镜像兼容性（画像未选时不判——verdict 显示为空）。创建守卫在 main，此处仅展示
  const verdicts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof assessImageCompatibility>>()
    if (selectedProfile === null) return map
    for (const entry of images.data) {
      map.set(entry.packageName, assessImageCompatibility(selectedProfile, entry, locale))
    }
    return map
  }, [selectedProfile, images.data, locale])
  const selectedVerdict =
    selectedImage === null ? null : (verdicts.get(selectedImage.packageName) ?? null)

  // 共享态收窄（plan 2026-10-12）：画像只留「有已装∧supported 镜像」者；镜像表
  // 仅列已装行（ImageTable sharedMode 分支）；managed/custom 分支零改动
  const sharedMode = sdkSource === 'shared-studio' && images.phase === 'ready'
  const profilesReady = profiles.phase === 'ready'
  const eligibleProfiles = useMemo(
    () =>
      sharedMode && profilesReady
        ? profiles.data.filter((entry) => profileHasSupportedImage(entry, images.data, locale))
        : profiles.data,
    [sharedMode, profilesReady, profiles.data, images.data, locale]
  )
  const hiddenProfileCount = sharedMode ? profiles.data.length - eligibleProfiles.length : 0
  const sharedNoImages = sharedMode && images.data.length === 0

  // 共享态单镜像自动选中（设计轴 3）：省一次点击；managed 不自动选
  useEffect(() => {
    if (!sharedMode || selectedProfile === null || image !== null) return
    const eligible = images.data.filter(
      (entry) => entry.installed && verdicts.get(entry.packageName)?.status === 'supported'
    )
    // 依赖驱动的单次写入：置入后 image !== null 条件翻转，下一 render 依赖不再变化，
    // 不构成级联渲染（镜像上方能力装载重置同款）。必须写状态而非渲染期派生——
    // 纯派生会在共享态条件消失（来源切走/清单变化）时丢掉已自动选中的镜像
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 写入即停：条件随 image 翻转，无级联
    if (eligible.length === 1) setImage(eligible[0])
  }, [sharedMode, selectedProfile, image, images.data, verdicts])

  // 独立窗体（无 X 按钮）：Esc 是键盘关闭路径，原生红绿灯/底部取消是另两条
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onCancel])

  const defaultName =
    selectedProfile && selectedImage
      ? `${selectedProfile.name} API ${apiDisplay(selectedImage)}`
      : ''
  const effectiveName = nameTouched ? name : defaultName
  // 完成门槛（plan 设计 3）：兼容 supported + 镜像完整安装 + 名称合法 + 清单就绪
  // + 无下载/创建事务。下载进度 100% 只是进度信号——重拉核验通过才算数
  const effectiveCapabilities = useMemo(
    () => resources.mergeOverlay(capabilities.data),
    [capabilities.data, resources]
  )
  const settingsCheck = useMemo(
    () =>
      effectiveCapabilities === null || advancedSettings === null
        ? { settings: null, errors: {} as Record<string, string> }
        : normalizeAdvancedSettings(advancedSettings, effectiveCapabilities, locale),
    [effectiveCapabilities, advancedSettings, locale]
  )
  const canCreate =
    effectiveName.trim().length > 0 &&
    selectedImage?.installed === true &&
    selectedVerdict?.status === 'supported' &&
    images.phase === 'ready' &&
    downloading === null &&
    resources.skinDownloading === null &&
    !resources.cameraBusy &&
    capabilities.phase === 'ready' &&
    Object.keys(settingsCheck.errors).length === 0

  // 防连击三层：ref 守卫（同 tick 连点）+ 按钮 disabled + state（跨 tick 视觉/语义）
  const create = async (): Promise<void> => {
    if (
      !selectedProfile ||
      !selectedImage ||
      !canCreate ||
      creatingRef.current ||
      resources.skinDownloading !== null
    )
      return
    creatingRef.current = true
    setCreating(true)
    try {
      await onCreate({
        profileId: selectedProfile.id,
        profileLabel: selectedProfile.name,
        imagePackageName: selectedImage.packageName,
        name: effectiveName.trim(),
        advancedSettings: settingsCheck.settings ?? advancedSettings ?? null
      })
    } finally {
      // 成功路径窗体随 IPC 关闭，此处 setState 落在卸载后是 no-op；失败路径恢复可重试
      creatingRef.current = false
      setCreating(false)
    }
  }

  const changeCategory = (next: DeviceFormFactor): void => {
    setCategory(next)
    // 更改类别清除不属于该类的选择
    if (selectedProfile !== null && selectedProfile.formFactor !== next) setProfile(null)
  }

  const selectProfile = (next: DeviceProfile): void => {
    setProfile(next)
    // 改画像：镜像兼容性随之变化，原选择若不再 supported 由核验派生自动失效
  }

  // 清单区反馈：首载无数据时居中等待；有数据刷新时列表保留、顶部紧凑提示
  const renderCatalogShell = (
    resource: ResourceState<DeviceProfile> | ResourceState<ImageEntry>,
    retry: () => void,
    loadingText: string,
    refreshingText: string,
    emptyText: string,
    content: React.JSX.Element,
    errorExtra: React.ReactNode = null
  ): React.JSX.Element => {
    const waiting = resource.phase === 'loading' || resource.phase === 'idle'
    if (waiting && resource.data.length === 0) {
      return (
        <div className="loading-block" role="status">
          <Loader2 size={16} aria-hidden="true" className="spinner" />
          <span className="loading-text">{loadingText}</span>
        </div>
      )
    }
    return (
      <>
        {resource.error !== null ? (
          <div className="error-block" role="alert">
            <span className="error-text">{resource.error}</span>
            <Button onClick={retry}>{copy.retry}</Button>
            {errorExtra}
          </div>
        ) : null}
        {waiting ? (
          <div className="refresh-row" role="status">
            <Loader2 size={12} aria-hidden="true" className="spinner" />
            {refreshingText}
          </div>
        ) : null}
        {resource.data.length > 0 ? (
          content
        ) : resource.phase === 'ready' ? (
          <p className="empty-hint">{emptyText}</p>
        ) : null}
      </>
    )
  }

  const renderPage = (): React.JSX.Element => {
    if (page === 1) {
      return renderCatalogShell(
        profiles,
        () => void reloadProfiles(),
        copy.loadingProfiles,
        copy.refreshingProfiles,
        copy.profilesEmpty,
        <ProfilePage
          profiles={sharedMode ? eligibleProfiles : profiles.data}
          category={category}
          onCategoryChange={changeCategory}
          search={search}
          onSearchChange={setSearch}
          showDeprecated={showDeprecated}
          selectedId={selectedProfile?.id ?? null}
          onSelect={selectProfile}
          hideEmptyCategories={sharedMode}
          filterNote={
            sharedMode && !sharedNoImages && hiddenProfileCount > 0
              ? format(copy.sharedModeFilteredProfiles, { count: hiddenProfileCount })
              : null
          }
          emptyNote={sharedNoImages ? copy.sharedModeNoImages : null}
        />,
        sdkBootstrapable ? (
          <>
            <Button onClick={() => void runSdkBootstrap()} disabled={bootstrapping}>
              {bootstrapping ? (
                <Loader2 size={12} aria-hidden="true" className="spinner" />
              ) : null}
              {bootstrapping ? copy.sdkBootstrapBusy : copy.sdkBootstrapAction}
            </Button>
            {bootstrapError !== null ? (
              <span className="error-text">{bootstrapError}</span>
            ) : null}
          </>
        ) : null
      )
    }
    return renderCatalogShell(
      images,
      () => void reloadImages(),
      copy.loadingImages,
      copy.refreshingImages,
      copy.imagesEmpty,
      <div className="configure-layout">
        <div className="main">
          <div className="tab-bar" role="tablist" aria-label={copy.configureSections}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'device'}
              onClick={() => setTab('device')}
              className="tab"
            >
              {copy.tabDevice}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'settings'}
              onClick={() => setTab('settings')}
              className="tab"
            >
              {copy.tabSettings}
            </button>
          </div>

          {/* 卸载/下载错误跨标签可见（review P3：切标签不丢错误视野） */}
          {downloadError !== null ? (
            <div className="error-block" role="alert">
              <span className="error-text">{downloadError.message}</span>
              <Button onClick={retryDownload}>{copy.retryDownload}</Button>
            </div>
          ) : null}
          {uninstallError !== null ? (
            <div className="error-block" role="alert">
              <span className="error-text">{uninstallError}</span>
              <Button onClick={() => setUninstallError(null)}>{copy.ok}</Button>
            </div>
          ) : null}

          {tab === 'device' ? (
            <div className="device-pane">
              <div className="name-block">
                <label className="name-label" htmlFor="wizard-device-name">
                  {copy.nameLabel}
                </label>
                <Input
                  id="wizard-device-name"
                  value={effectiveName}
                  maxLength={50}
                  placeholder={copy.namePlaceholder}
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameTouched(true)
                  }}
                />
                <p className="name-hint">{copy.nameHint}</p>
              </div>
              <ImageTable
                images={images.data}
                filters={imageFilters}
                onFiltersChange={setImageFilters}
                verdicts={verdicts}
                selectedPackageName={selectedImage?.packageName ?? null}
                onSelect={setImage}
                downloading={downloading}
                onDownload={(entry) => void download(entry)}
                onCancelDownload={(packageName) => void cancelDownload(packageName)}
                downloadBusy={downloading !== null}
                onUninstall={(entry) => void uninstall(entry)}
                uninstallingPackage={uninstallingPackage}
                sharedMode={sharedMode}
              />
            </div>
          ) : (
            <div className="settings-pane">
              {capabilities.phase === 'loading' || capabilities.phase === 'idle' ? (
                <p className="settings-hint">{copy.loadingCapabilities}</p>
              ) : capabilities.phase === 'error' ? (
                <p className="settings-hint">{capabilities.error}</p>
              ) : capabilities.data !== null && advancedSettings !== null ? (
                <SettingsForm
                  capabilities={effectiveCapabilities ?? capabilities.data}
                  value={advancedSettings}
                  errors={settingsCheck.errors}
                  onChange={(next) => {
                    if (selectedProfile !== null && next.skinRef !== advancedSettings.skinRef)
                      skinChoicesRef.current.set(selectedProfile.id, next.skinRef)
                    setAdvancedSettings(next)
                  }}
                  skins={resources.skins}
                  onImportSkin={resources.importSkin}
                  onDownloadSkin={resources.downloadSkinByName}
                  skinDownloading={resources.skinDownloading}
                  skinError={resources.skinError}
                  cameraBusy={resources.cameraBusy}
                  cameraError={resources.cameraError}
                  onCameraAction={resources.cameraAction}
                />
              ) : null}
            </div>
          )}
        </div>
        <SummaryPanel profile={selectedProfile} image={selectedImage} verdict={selectedVerdict} />
      </div>
    )
  }

  return (
    <Wrapper>
      <header className="header">
        {window.api?.platform === 'darwin' ? (
          <span className="traffic-spacer" aria-hidden="true" />
        ) : null}
        <div className="title-group">
          <h3 className="heading">{copy.wizardHeading}</h3>
          <span className="step-indicator">
            {format(copy.stepIndicator, {
              page,
              title: page === 1 ? copy.pageProfiles : copy.pageConfigure
            })}
          </span>
        </div>
      </header>

      <div className="body">{renderPage()}</div>

      <footer className="footer">
        <Button onClick={onCancel}>{copy.cancel}</Button>
        {page === 2 ? <Button onClick={() => setPage(1)}>{copy.back}</Button> : null}
        {page === 1 ? (
          <Button
            variant="primary"
            disabled={selectedProfile === null || profiles.phase !== 'ready'}
            onClick={() => setPage(2)}
          >
            {copy.next}
          </Button>
        ) : (
          <Button variant="primary" disabled={!canCreate || creating} onClick={create}>
            {creating ? copy.creating : copy.create}
          </Button>
        )}
      </footer>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  background: var(--board-bg);

  .header {
    position: relative;
    display: flex;
    align-items: center;
    flex: none;
    height: 40px;
    padding-left: 14px;
    border-bottom: 1px solid var(--board-hairline);
    /* 板头整行是窗口拖拽带（darwin 原生标题条已去，对齐主窗 BoardHead 模式）；
       标题组绝对定位水平居中于窗口中线（用户裁决），垂直落板头中线（与三灯 y=12 共线） */
    -webkit-app-region: drag;
  }

  /* darwin 原生三灯让位（60px no-drag 占位；标题组改绝对居中后，占位只负责三灯区禁拖） */
  .traffic-spacer {
    flex: none;
    width: 60px;
    -webkit-app-region: no-drag;
  }

  /* 标题组：两段字号不同（14/11px）在组内基线对齐；整组绝对定位——水平居中于窗口、垂直居中于板头。
     div 而非 span：内含 h3（flow content），span 只许 phrasing content（review 2026-10-06） */
  .title-group {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .heading {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .step-indicator {
    font-size: 11px;
    color: var(--board-ink-dim);
  }

  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    padding: 0 0 8px;
  }

  .loading-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 180px;
    color: var(--board-ink-dim);
  }

  .loading-text {
    font-size: 12px;
  }

  .spinner {
    color: var(--loading);
    animation: spin 1.2s linear infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .refresh-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    font-size: 11px;
    color: var(--board-ink-dim);
  }

  .empty-hint {
    margin: 0;
    padding: 16px;
    font-size: 12px;
    color: var(--board-ink-dim);
  }

  .error-block {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 16px;
    padding: 8px 10px;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: var(--board-bg);
  }

  .error-text {
    flex: 1;
    font-size: 12px;
    color: var(--board-ink);
  }

  .configure-layout {
    display: flex;
    min-height: 0;
    flex: 1;
  }

  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .tab-bar {
    display: flex;
    gap: 4px;
    flex: none;
    padding: 10px 16px 0;
    border-bottom: 1px solid var(--board-hairline);
  }

  .tab {
    padding: 7px 14px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--board-ink-dim);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.12s;

    &:hover {
      color: var(--board-ink);
    }

    &[aria-selected='true'] {
      color: var(--board-ink);
      font-weight: 600;
      border-bottom-color: var(--accent);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
    }
  }

  .device-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: 10px;
    padding: 12px 16px;
  }

  .name-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: none;
  }

  .name-label {
    font-size: 12px;
    color: var(--board-ink-dim);
  }

  .name-hint {
    margin: 0;
    font-size: 11px;
    color: var(--board-ink-dim);
  }

  .settings-pane {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    flex: 1;
    padding: 0;
  }

  .settings-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.7;
    color: var(--board-ink-dim);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex: none;
    padding: 12px 16px;
    border-top: 1px solid var(--board-hairline);
  }
`

export default DeviceWizard
