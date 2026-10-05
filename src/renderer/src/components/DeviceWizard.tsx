import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import styled from 'styled-components'
import type { CreateDeviceInput, DeviceProfile, ImageEntry, ImageVariant } from '@shared/types'
import Button from './Button'
import Input from './Input'

const VARIANT_LABELS: Record<ImageVariant, string> = {
  aosp: 'AOSP',
  google_apis: 'Google APIs',
  google_play: 'Google Play'
}

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: '选择设备画像',
  2: '选择系统镜像',
  3: '命名设备'
}

const formatSize = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type WizardVariant = 'panel' | 'window'

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

const fetchImages = async (): Promise<ImageEntry[]> => {
  if (typeof window === 'undefined' || !window.api?.sdk) {
    throw new Error('sdk api 不可用')
  }
  return window.api.sdk.images()
}

type DeviceWizardProps = {
  /** panel = 主窗右栏内嵌卡片；window = 原生模态子窗整页（Esc 关闭） */
  variant?: WizardVariant
  /** 返回 promise 时按钮进入创建中禁用态（防连击，issue 2026-10-04-wizard-create-no-double-click-guard） */
  onCreate: (input: CreateDeviceInput) => void | Promise<void>
  onCancel: () => void
  /** 数据注入（测试用）；缺省从 window.api.sdk 拉取 */
  data?: DeviceWizardData
  /** 下载触发注入（测试用）；缺省走 sdk.downloadImage */
  onDownloadImage?: (packageName: string) => Promise<void>
}

/** 三步向导（画像 → 镜像 → 命名）：panel 占主窗画布区；window 填满模态子窗视口 */
const DeviceWizard = ({
  variant = 'panel',
  onCreate,
  onCancel,
  data,
  onDownloadImage
}: DeviceWizardProps): React.JSX.Element => {
  const [step, setStep] = useState<1 | 2 | 3>(1)
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

  // 首载：无注入数据时两份清单并发发起，成功失败各自接住，互不拖住
  useEffect(() => {
    if (data) return
    void reloadProfiles()
    void reloadImages()
  }, [data, reloadProfiles, reloadImages])

  // 下载进度订阅：同包名写进度，完成后重拉清单（拿已装标记；已有数据 → 紧凑刷新反馈）
  useEffect(() => {
    if (data) return
    return window.api.sdk.onImageProgress((progress) => {
      setDownloading({ packageName: progress.packageName, percent: progress.percent })
      if (progress.percent >= 100) {
        setDownloading(null)
        void reloadImages()
      }
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

  // window 变体是独立窗体：焦点不在任何元素上时 Esc 也应能取消（panel 无此语义）
  useEffect(() => {
    if (variant !== 'window') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [variant, onCancel])

  const defaultName =
    selectedProfile && selectedImage ? `${selectedProfile.name} API ${selectedImage.apiLevel}` : ''
  const effectiveName = nameTouched ? name : defaultName
  // 镜像清单刷新未确认前不放行创建——等新清单核验选择后再允许
  const canCreate =
    effectiveName.trim().length > 0 &&
    (selectedImage?.installed ?? false) &&
    images.phase === 'ready'

  const goNext = (): void => {
    if (step === 1 && selectedProfile && profiles.phase === 'ready') setStep(2)
    else if (step === 2 && selectedImage?.installed && images.phase === 'ready') setStep(3)
  }

  // 防连击三层：ref 守卫（同 tick 连点）+ 按钮 disabled + state（跨 tick 视觉/语义）
  const create = async (): Promise<void> => {
    if (!selectedProfile || !selectedImage || !canCreate || creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    try {
      await onCreate({
        profileId: selectedProfile.id,
        profileLabel: selectedProfile.name,
        apiLevel: selectedImage.apiLevel,
        variant: selectedImage.variant,
        name: effectiveName.trim()
      })
    } finally {
      // 成功路径窗体随 IPC 关闭，此处 setState 落在卸载后是 no-op；失败路径恢复可重试
      creatingRef.current = false
      setCreating(false)
    }
  }

  // 清单区反馈：首载无数据时居中等待；有数据刷新时列表保留、顶部紧凑提示
  const renderCatalogShell = (
    resource: ResourceState<DeviceProfile> | ResourceState<ImageEntry>,
    retry: () => void,
    loadingText: string,
    refreshingText: string,
    emptyText: string,
    list: React.JSX.Element
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
          list
        ) : resource.phase === 'ready' ? (
          <EmptyHint>{emptyText}</EmptyHint>
        ) : null}
      </>
    )
  }

  const renderBody = (): React.JSX.Element => {
    if (step === 1) {
      return (
        <CatalogRegion aria-busy={profiles.phase === 'loading'}>
          {renderCatalogShell(
            profiles,
            () => void reloadProfiles(),
            '正在加载设备画像…',
            '正在刷新设备画像…',
            '画像清单为空',
            <OptionGroup role="group" aria-label={STEP_TITLES[1]}>
              {profiles.data.map((entry) => (
                <OptionButton
                  key={entry.id}
                  type="button"
                  aria-pressed={selectedProfile?.id === entry.id}
                  onClick={() => setProfile(entry)}
                >
                  <OptionTitle>{entry.name}</OptionTitle>
                </OptionButton>
              ))}
            </OptionGroup>
          )}
        </CatalogRegion>
      )
    }
    if (step === 2) {
      return (
        <CatalogRegion aria-busy={images.phase === 'loading'}>
          {renderCatalogShell(
            images,
            () => void reloadImages(),
            '正在加载系统镜像…',
            '正在刷新系统镜像…',
            '清单为空',
            <OptionGroup role="group" aria-label={STEP_TITLES[2]}>
              {images.data.map((entry) => {
                const key = `${entry.apiLevel}-${entry.variant}`
                const isDownloading = downloading?.packageName === entry.packageName
                const busy = downloading !== null
                return (
                  <ImageRow
                    key={key}
                    type="button"
                    aria-pressed={selectedImage?.packageName === entry.packageName}
                    disabled={busy}
                    onClick={() => {
                      if (entry.installed) setImage(entry)
                    }}
                  >
                    <ImageInfo>
                      <OptionTitle>
                        API {entry.apiLevel} · {VARIANT_LABELS[entry.variant]}
                      </OptionTitle>
                      <OptionSub>
                        arm64-v8a ·{' '}
                        {entry.installed ? '已安装' : `下载 ${formatSize(entry.sizeBytes)}`}
                      </OptionSub>
                    </ImageInfo>
                    {!entry.installed ? (
                      <DownloadButton
                        role="button"
                        aria-disabled={busy}
                        aria-label={`下载 API ${entry.apiLevel} ${VARIANT_LABELS[entry.variant]}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          void download(entry)
                        }}
                      >
                        {isDownloading ? `${downloading.percent}%` : <Download size={14} />}
                      </DownloadButton>
                    ) : null}
                  </ImageRow>
                )
              })}
            </OptionGroup>
          )}
          {downloadError !== null ? (
            <ErrorBlock role="alert">
              <ErrorText>{downloadError.message}</ErrorText>
              <Button onClick={retryDownload}>重试下载</Button>
            </ErrorBlock>
          ) : null}
        </CatalogRegion>
      )
    }
    return (
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
        <NameHint>默认「设备画像名 + API 版本」，可改。</NameHint>
      </NameBlock>
    )
  }

  return (
    <Wrapper $variant={variant}>
      <Header>
        <Heading>新建设备</Heading>
        <StepIndicator>
          第 {step} / 3 步 · {STEP_TITLES[step]}
        </StepIndicator>
        <CloseButton type="button" aria-label="取消新建" onClick={onCancel}>
          <X size={16} />
        </CloseButton>
      </Header>

      <Body>{renderBody()}</Body>

      <Footer>
        {step > 1 ? (
          <Button
            onClick={() => {
              if (step === 2) setImage(null)
              else setNameTouched(false)
              setStep(step === 2 ? 1 : 2)
            }}
          >
            上一步
          </Button>
        ) : null}
        {step < 3 ? (
          <Button
            variant="primary"
            disabled={
              (step === 1 && (!selectedProfile || profiles.phase !== 'ready')) ||
              (step === 2 && (!selectedImage?.installed || images.phase !== 'ready'))
            }
            onClick={goNext}
          >
            下一步
          </Button>
        ) : (
          <Button variant="primary" disabled={!canCreate || creating} onClick={create}>
            创建
          </Button>
        )}
      </Footer>
    </Wrapper>
  )
}

const Wrapper = styled.div<{ $variant: WizardVariant }>`
  display: flex;
  flex-direction: column;

  ${({ $variant }) =>
    $variant === 'panel'
      ? `
        width: min(480px, 100%);
        max-height: 100%;
        background: var(--board-bg-raised);
        border: 1px solid var(--board-hairline);
      `
      : `
        width: 100%;
        height: 100vh;
        background: var(--board-bg);
      `}
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
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 16px;
`

const CatalogRegion = styled.div`
  display: flex;
  flex-direction: column;
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
  padding: 6px 0;
  font-size: 11px;
  color: var(--board-ink-dim);
`

const OptionGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
`

const OptionButton = styled.button`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  text-align: left;
  background: var(--board-bg);
  color: var(--board-ink);
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.12s,
    border-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
  }

  &[aria-pressed='true'] {
    border-color: var(--board-ink);
    background: var(--board-segment-selected-bg);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
`

const OptionTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
`

const OptionSub = styled.span`
  font-size: 11px;
  line-height: 1.5;
  color: var(--board-ink-dim);
`

const ImageRow = styled(OptionButton)`
  flex-direction: row;
  align-items: center;
  gap: 8px;

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`

const ImageInfo = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`

const DownloadButton = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg-raised);
  color: var(--board-ink);
  font-size: 11px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  &[aria-disabled='true'] {
    cursor: default;
    opacity: 0.7;
  }
`

const EmptyHint = styled.p`
  margin: 0;
  padding: 16px 0;
  font-size: 12px;
  color: var(--board-ink-dim);
`

const ErrorBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
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

const NameBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
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

const Footer = styled.footer`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex: none;
  padding: 12px 16px;
  border-top: 1px solid var(--board-hairline);
`

export default DeviceWizard
