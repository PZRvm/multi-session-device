import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import styled from 'styled-components'
import type {
  CreateDeviceInput,
  DeviceAdvancedSettings,
  DeviceFormFactor,
  DeviceProfile,
  ImageEntry,
  WizardCapabilities
} from '@shared/types'
import { assessImageCompatibility } from '@shared/compatibility'
import { normalizeAdvancedSettings } from '@shared/settings-contract'
import Button from './Button'
import Input from './Input'
import ProfilePage from './wizard/ProfilePage'
import ImageTable, { type ImageFilters } from './wizard/ImageTable'
import SummaryPanel from './wizard/SummaryPanel'
import SettingsForm from './wizard/SettingsForm'
import { apiDisplay, messageOf } from './wizard/shared'

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
    throw new Error('sdk api 不可用')
  }
  return window.api.sdk.profiles()
}

/** 最近一次清单响应携带的下载任务（向导重开恢复用；ref 避免绕过请求代次守卫） */
let lastActiveDownload: { packageName: string; percent: number } | null = null

const fetchImages = async (): Promise<ImageEntry[]> => {
  if (typeof window === 'undefined' || !window.api?.sdk) {
    throw new Error('sdk api 不可用')
  }
  const catalog = await window.api.sdk.images()
  lastActiveDownload = catalog.activeDownload
  return catalog.images
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
}

const PAGE_TITLES: Record<1 | 2, string> = {
  1: '选择画像',
  2: '配置设备'
}

const DeviceWizard = ({
  onCreate,
  onCancel,
  data,
  onDownloadImage,
  onWizardCapabilities
}: DeviceWizardProps): React.JSX.Element => {
  const [page, setPage] = useState<1 | 2>(1)
  // 画像页筛选
  const [category, setCategory] = useState<DeviceFormFactor>('phone')
  const [search, setSearch] = useState('')
  const [showDeprecated, setShowDeprecated] = useState(false)
  // 配置页
  const [tab, setTab] = useState<WizardTab>('device')
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
  const { resource: images, reload: reloadImages } = useCatalogResource<ImageEntry>(
    fetchImages,
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
    if (images.phase === 'ready' && downloading === null && lastActiveDownload !== null) {
      const restore = lastActiveDownload
      lastActiveDownload = null
      // 一次性恢复（记录已消费）——不构成级联渲染
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDownloading({ ...restore })
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
  // 皮肤域：清单（导入/下载后刷新）、下载互斥与进度
  const [skins, setSkins] = useState<Array<{ skinRef: string; name: string; source: string }>>([])
  const [skinDownloading, setSkinDownloading] = useState<string | null>(null)

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

  const reloadSkins = async (): Promise<void> => {
    try {
      const list = data
        ? [] // 注入场景（测试）不拉真实皮肤清单
        : await window.api.sdk.deviceSkins()
      setSkins(
        list.map((skin) => ({ skinRef: skin.skinRef, name: skin.name, source: skin.source }))
      )
    } catch {
      setSkins([])
    }
  }

  useEffect(() => {
    // 装载动作走 async——列表落位在 promise 回调，不在 effect 内同步 setState
    if (data === undefined && page === 2) {
      void (async () => {
        await reloadSkins()
      })()
    }
  }, [data, page])

  const importSkin = async (): Promise<void> => {
    try {
      const added = await window.api.sdk.chooseDeviceSkin()
      await reloadSkins()
      setAdvancedSettings((prev) => (prev === null ? prev : { ...prev, skinRef: added.skinRef }))
    } catch {
      // 取消选择器或导入失败：清单保持，错误由对话框域呈现
    }
  }

  const downloadSkinByName = async (skinName: string): Promise<void> => {
    if (skinDownloading !== null) return
    setSkinDownloading(skinName)
    try {
      const added = await window.api.sdk.downloadDeviceSkin(skinName)
      await reloadSkins()
      setAdvancedSettings((prev) => (prev === null ? prev : { ...prev, skinRef: added.skinRef }))
    } catch {
      // 下载失败：保持现状（进度通道已结束）
    } finally {
      setSkinDownloading(null)
    }
  }

  const download = async (entry: ImageEntry): Promise<void> => {
    if (downloadingRef.current) return
    downloadingRef.current = true
    setDownloading({ packageName: entry.packageName, percent: 0 })
    setDownloadError(null)
    try {
      if (onDownloadImage) await onDownloadImage(entry.packageName)
      else await window.api.sdk.downloadImage(entry.packageName)
      // 注入场景（测试）无进度可等，也不做真实重拉
      if (!data) await reloadImages()
    } catch (error) {
      setDownloadError({ message: messageOf(error), packageName: entry.packageName })
    } finally {
      downloadingRef.current = false
      setDownloading(null)
    }
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedProfile === null || selectedImage === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCapabilities({ phase: 'idle', data: null, error: null })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAdvancedSettings(null)
      return
    }
    const generation = ++capabilityGenerationRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCapabilities((prev) => ({ ...prev, phase: 'loading', error: null }))
    const fetchCapabilities = async (): Promise<void> => {
      try {
        const result = onWizardCapabilities
          ? await onWizardCapabilities(selectedProfile.id, selectedImage.packageName)
          : await window.api.sdk.wizardCapabilities(selectedProfile.id, selectedImage.packageName)
        if (generation !== capabilityGenerationRef.current) return
        setCapabilities({ phase: 'ready', data: result, error: null })
        setAdvancedSettings(result.defaults)
      } catch (error) {
        if (generation !== capabilityGenerationRef.current) return
        setCapabilities({ phase: 'error', data: null, error: messageOf(error) })
      }
    }
    void fetchCapabilities()
    // selectedProfile/selectedImage 为渲染期派生的核验值，身份随清单刷新自动失效
  }, [selectedProfile?.id, selectedImage?.packageName, onWizardCapabilities])

  // 逐镜像兼容性（画像未选时不判——verdict 显示为空）。创建守卫在 main，此处仅展示
  const verdicts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof assessImageCompatibility>>()
    if (selectedProfile === null) return map
    for (const entry of images.data) {
      map.set(entry.packageName, assessImageCompatibility(selectedProfile, entry))
    }
    return map
  }, [selectedProfile, images.data])
  const selectedVerdict =
    selectedImage === null ? null : (verdicts.get(selectedImage.packageName) ?? null)

  // 独立窗体：焦点不在任何元素上时 Esc 也应能取消
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
  const settingsCheck = useMemo(
    () =>
      capabilities.data === null || advancedSettings === null
        ? { settings: null, errors: {} as Record<string, string> }
        : normalizeAdvancedSettings(advancedSettings, capabilities.data),
    [capabilities.data, advancedSettings]
  )
  const canCreate =
    effectiveName.trim().length > 0 &&
    selectedImage?.installed === true &&
    selectedVerdict?.status === 'supported' &&
    images.phase === 'ready' &&
    downloading === null &&
    capabilities.phase === 'ready' &&
    Object.keys(settingsCheck.errors).length === 0

  // 防连击三层：ref 守卫（同 tick 连点）+ 按钮 disabled + state（跨 tick 视觉/语义）
  const create = async (): Promise<void> => {
    if (!selectedProfile || !selectedImage || !canCreate || creatingRef.current) return
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
    content: React.JSX.Element
  ): React.JSX.Element => {
    const waiting = resource.phase === 'loading' || resource.phase === 'idle'
    if (waiting && resource.data.length === 0) {
      return (
        <LoadingBlock role="status">
          <Spinner size={16} aria-hidden="true" />
          <LoadingText>{loadingText}</LoadingText>
        </LoadingBlock>
      )
    }
    return (
      <>
        {resource.error !== null ? (
          <ErrorBlock role="alert">
            <ErrorText>{resource.error}</ErrorText>
            <Button onClick={retry}>重试</Button>
          </ErrorBlock>
        ) : null}
        {waiting ? (
          <RefreshRow role="status">
            <Spinner size={12} aria-hidden="true" />
            {refreshingText}
          </RefreshRow>
        ) : null}
        {resource.data.length > 0 ? (
          content
        ) : resource.phase === 'ready' ? (
          <EmptyHint>{emptyText}</EmptyHint>
        ) : null}
      </>
    )
  }

  const renderPage = (): React.JSX.Element => {
    if (page === 1) {
      return renderCatalogShell(
        profiles,
        () => void reloadProfiles(),
        '正在加载设备画像…',
        '正在刷新设备画像…',
        '画像清单为空',
        <ProfilePage
          profiles={profiles.data}
          category={category}
          onCategoryChange={changeCategory}
          search={search}
          onSearchChange={setSearch}
          showDeprecated={showDeprecated}
          onShowDeprecatedChange={setShowDeprecated}
          selectedId={selectedProfile?.id ?? null}
          onSelect={selectProfile}
        />
      )
    }
    return renderCatalogShell(
      images,
      () => void reloadImages(),
      '正在加载系统镜像…',
      '正在刷新系统镜像…',
      '镜像清单为空',
      <ConfigureLayout>
        <Main>
          <TabBar role="tablist" aria-label="配置分区">
            <Tab
              type="button"
              role="tab"
              aria-selected={tab === 'device'}
              onClick={() => setTab('device')}
            >
              设备
            </Tab>
            <Tab
              type="button"
              role="tab"
              aria-selected={tab === 'settings'}
              onClick={() => setTab('settings')}
            >
              附加设置
            </Tab>
          </TabBar>

          {tab === 'device' ? (
            <DevicePane>
              <NameBlock>
                <NameLabel htmlFor="wizard-device-name">设备名称</NameLabel>
                <Input
                  id="wizard-device-name"
                  value={effectiveName}
                  maxLength={50}
                  placeholder="设备画像名 + API 版本"
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameTouched(true)
                  }}
                />
                <NameHint>默认「设备画像名 + API 版本」；改过后切换镜像不覆盖你的输入。</NameHint>
              </NameBlock>
              <ImageTable
                images={images.data}
                filters={imageFilters}
                onFiltersChange={setImageFilters}
                verdicts={verdicts}
                selectedPackageName={selectedImage?.packageName ?? null}
                onSelect={setImage}
                downloading={downloading}
                onDownload={(entry) => void download(entry)}
                downloadBusy={downloading !== null}
              />
              {downloadError !== null ? (
                <ErrorBlock role="alert">
                  <ErrorText>{downloadError.message}</ErrorText>
                  <Button onClick={retryDownload}>重试下载</Button>
                </ErrorBlock>
              ) : null}
            </DevicePane>
          ) : (
            <SettingsPane>
              {capabilities.phase === 'loading' || capabilities.phase === 'idle' ? (
                <SettingsHint>正在加载设置能力…</SettingsHint>
              ) : capabilities.phase === 'error' ? (
                <SettingsHint>{capabilities.error}</SettingsHint>
              ) : capabilities.data !== null && advancedSettings !== null ? (
                <SettingsForm
                  capabilities={capabilities.data}
                  value={advancedSettings}
                  errors={settingsCheck.errors}
                  onChange={setAdvancedSettings}
                  skins={skins}
                  onImportSkin={importSkin}
                  onDownloadSkin={downloadSkinByName}
                  skinDownloading={skinDownloading}
                />
              ) : null}
            </SettingsPane>
          )}
        </Main>
        <SummaryPanel profile={selectedProfile} image={selectedImage} verdict={selectedVerdict} />
      </ConfigureLayout>
    )
  }

  return (
    <Wrapper>
      <Header>
        <Heading>新建设备</Heading>
        <StepIndicator>
          第 {page} / 2 页 · {PAGE_TITLES[page]}
        </StepIndicator>
        <CloseButton type="button" aria-label="取消新建" onClick={onCancel}>
          <X size={16} />
        </CloseButton>
      </Header>

      <Body>{renderPage()}</Body>

      <Footer>
        <Button onClick={onCancel}>取消</Button>
        {page === 2 ? <Button onClick={() => setPage(1)}>上一步</Button> : null}
        {page === 1 ? (
          <Button
            variant="primary"
            disabled={selectedProfile === null || profiles.phase !== 'ready'}
            onClick={() => setPage(2)}
          >
            下一步
          </Button>
        ) : (
          <Button variant="primary" disabled={!canCreate || creating} onClick={create}>
            {creating ? '创建中…' : '创建'}
          </Button>
        )}
      </Footer>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  background: var(--board-bg);
`

const Header = styled.header`
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: none;
  padding: 12px 16px;
  border-bottom: 1px solid var(--board-hairline);
`

const Heading = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
`

const StepIndicator = styled.span`
  flex: 1;
  font-size: 11px;
  color: var(--board-ink-dim);
`

const CloseButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--board-ink-dim);
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
    color: var(--board-ink);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 0 0 8px;
`

const LoadingBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 180px;
  color: var(--board-ink-dim);
`

const LoadingText = styled.span`
  font-size: 12px;
`

const Spinner = styled(Loader2)`
  color: var(--loading);
  animation: spin 1.2s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`

const RefreshRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 11px;
  color: var(--board-ink-dim);
`

const EmptyHint = styled.p`
  margin: 0;
  padding: 16px;
  font-size: 12px;
  color: var(--board-ink-dim);
`

const ErrorBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 16px;
  padding: 8px 10px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
`

const ErrorText = styled.span`
  flex: 1;
  font-size: 12px;
  color: var(--board-ink);
`

const ConfigureLayout = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
`

const Main = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
`

const TabBar = styled.div`
  display: flex;
  gap: 4px;
  flex: none;
  padding: 10px 16px 0;
  border-bottom: 1px solid var(--board-hairline);
`

const Tab = styled.button`
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
`

const DevicePane = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  gap: 10px;
  padding: 12px 16px;
`

const NameBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
`

const NameLabel = styled.label`
  font-size: 12px;
  color: var(--board-ink-dim);
`

const NameHint = styled.p`
  margin: 0;
  font-size: 11px;
  color: var(--board-ink-dim);
`

const SettingsPane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  padding: 0;
`

const SettingsHint = styled.p`
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--board-ink-dim);
`

const Footer = styled.footer`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex: none;
  padding: 12px 16px;
  border-top: 1px solid var(--board-hairline);
`

export default DeviceWizard
