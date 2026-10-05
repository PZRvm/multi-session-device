import styled from 'styled-components'
import { Download, Loader2 } from 'lucide-react'
import type { CompatibilityVerdict } from '@shared/compatibility'
import type { ImageEntry, ImageService } from '@shared/types'
import { apiDisplay, formatSize, recommendedWindow, serviceLabel, serviceLabels } from './shared'

/**
 * 配置页「设备」标签的镜像表格：API/服务筛选 + 推荐/完整/Preview/扩展/不支持
 * 开关 + 逐行兼容性与下载。兼容性用 main 同源的纯函数判定（创建守卫在 main，
 * 展示开关不改变创建资格）。
 */

export interface ImageFilters {
  service: 'all' | ImageService
  showFullList: boolean
  showPreview: boolean
  showUnsupported: boolean
}

export interface ImageTableProps {
  images: ImageEntry[]
  filters: ImageFilters
  onFiltersChange: (filters: ImageFilters) => void
  /** 按画像预判定的兼容性（packageName → verdict） */
  verdicts: Map<string, CompatibilityVerdict>
  selectedPackageName: string | null
  onSelect: (image: ImageEntry) => void
  downloading: { packageName: string; percent: number } | null
  onDownload: (image: ImageEntry) => void
  downloadBusy: boolean
  /** 卸载已装镜像（确认框在 DeviceWizard 层统一处理）；null = 未提供该能力 */
  onUninstall: ((image: ImageEntry) => void) | null
  /** 正在卸载的包名（该行显示 spinner，其余行禁用）；null = 无卸载任务 */
  uninstallingPackage: string | null
}

const ImageTable = ({
  images,
  filters,
  onFiltersChange,
  verdicts,
  selectedPackageName,
  onSelect,
  downloading,
  onDownload,
  downloadBusy,
  onUninstall,
  uninstallingPackage
}: ImageTableProps): React.JSX.Element => {
  const window = recommendedWindow(images)
  const rows = images.filter((image) => {
    const verdict = verdicts.get(image.packageName)
    const status = verdict?.status ?? 'unknown'
    const formal = image.api.codename === null
    if (status === 'unsupported' && !filters.showUnsupported) return false
    if (!formal && !filters.showPreview) return false
    if (filters.service !== 'all' && !image.services.includes(filters.service)) return false
    // 推荐视图只看最近五个正式（非扩展）major；扩展平台与窗口外版本都走完整列表开关
    if (
      !filters.showFullList &&
      formal &&
      (image.api.extensionLevel !== null || !window.has(image.api.major ?? -1))
    ) {
      return false
    }
    return true
  })

  const serviceOptions: Array<{ value: ImageFilters['service']; label: string }> = [
    { value: 'all', label: '全部服务' },
    { value: 'google_play', label: 'Google Play' },
    { value: 'google_apis', label: 'Google APIs' },
    { value: 'aosp', label: 'AOSP' },
    { value: 'wear', label: 'Wear OS' },
    { value: 'tv', label: 'Android TV' },
    { value: 'automotive', label: 'Automotive' }
  ]

  return (
    <Layout>
      <Toolbar>
        <ServiceSelect
          value={filters.service}
          aria-label="服务筛选"
          onChange={(event) =>
            onFiltersChange({ ...filters, service: event.target.value as ImageFilters['service'] })
          }
        >
          {serviceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </ServiceSelect>
        <SwitchRow>
          <Switch>
            <input
              id="wizard-images-full"
              type="checkbox"
              checked={filters.showFullList}
              onChange={(event) =>
                onFiltersChange({ ...filters, showFullList: event.target.checked })
              }
            />
            <label htmlFor="wizard-images-full">完整列表</label>
          </Switch>
          <Switch>
            <input
              id="wizard-images-preview"
              type="checkbox"
              checked={filters.showPreview}
              onChange={(event) =>
                onFiltersChange({ ...filters, showPreview: event.target.checked })
              }
            />
            <label htmlFor="wizard-images-preview">Preview</label>
          </Switch>
          <Switch>
            <input
              id="wizard-images-unsupported"
              type="checkbox"
              checked={filters.showUnsupported}
              onChange={(event) =>
                onFiltersChange({ ...filters, showUnsupported: event.target.checked })
              }
            />
            <label htmlFor="wizard-images-unsupported">不支持项</label>
          </Switch>
        </SwitchRow>
      </Toolbar>

      <Scroller>
        <HeadRow>
          <HeadCell>API</HeadCell>
          <HeadCell>服务</HeadCell>
          <HeadCell>ABI</HeadCell>
          <HeadCell className="num">大小</HeadCell>
          <HeadCell className="num">状态</HeadCell>
        </HeadRow>
        {rows.map((image) => {
          const verdict = verdicts.get(image.packageName)
          const selected = image.packageName === selectedPackageName
          const isDownloading = downloading?.packageName === image.packageName
          const selectable = image.installed && verdict?.status === 'supported'
          return (
            <Row
              key={image.packageName}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-disabled={!selectable}
              data-image-package={image.packageName}
              onClick={() => {
                if (selectable) onSelect(image)
              }}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && selectable) {
                  event.preventDefault()
                  onSelect(image)
                }
              }}
            >
              <ApiCell>
                API {apiDisplay(image)}
                {image.api.codename !== null ? <RowTag>{image.api.codename}</RowTag> : null}
                {image.api.extensionLevel !== null ? (
                  <RowTag>扩展 {image.api.extensionLevel}</RowTag>
                ) : null}
                {image.featureTags.map((tag) => (
                  <RowTag key={tag}>{tag === 'page_size_16kb' ? '16KB 页' : tag}</RowTag>
                ))}
              </ApiCell>
              <Cell>{serviceLabels(image).join(' + ')}</Cell>
              <Cell>{image.abi}</Cell>
              <Cell className="num">{image.installed ? '—' : formatSize(image.sizeBytes)}</Cell>
              <StatusCell className="num">
                {image.installed ? (
                  <>
                    {verdict?.status === 'supported' ? (
                      '已安装'
                    ) : (
                      <Reason title={verdict?.reasons.join('；') ?? ''}>
                        已安装 · {verdict?.status === 'unknown' ? '兼容性未知' : '不兼容'}
                      </Reason>
                    )}
                    {onUninstall !== null ? (
                      <UninstallButton
                        role="button"
                        aria-disabled={uninstallingPackage !== null || downloadBusy}
                        aria-label={`删除已安装镜像 API ${apiDisplay(image)} ${serviceLabel(image)}`}
                        title="删除已安装的镜像"
                        onClick={(event) => {
                          event.stopPropagation()
                          onUninstall(image)
                        }}
                      >
                        {uninstallingPackage === image.packageName ? (
                          <>
                            <UninstallSpinner size={12} aria-hidden="true" />
                            删除中…
                          </>
                        ) : (
                          '删除'
                        )}
                      </UninstallButton>
                    ) : null}
                  </>
                ) : (
                  <DownloadButton
                    role="button"
                    aria-disabled={downloadBusy}
                    aria-label={`下载 API ${apiDisplay(image)} ${serviceLabel(image)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDownload(image)
                    }}
                  >
                    {isDownloading ? `${downloading.percent}%` : <Download size={13} />}
                  </DownloadButton>
                )}
              </StatusCell>
            </Row>
          )
        })}
        {rows.length === 0 ? <EmptyHint>当前筛选下没有镜像</EmptyHint> : null}
      </Scroller>
      <Legend>
        推荐视图默认展示最近五个正式 API；完整列表、Preview、扩展与不支持项按开关展开。
        兼容性原因悬停可见，展示开关不改变创建资格。
      </Legend>
    </Layout>
  )
}

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  gap: 8px;
`

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  flex-wrap: wrap;
`

const ServiceSelect = styled.select`
  padding: 5px 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
  color: var(--board-ink);
  font-size: 12px;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const SwitchRow = styled.div`
  display: flex;
  gap: 12px;
`

const Switch = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--board-ink-dim);

  label {
    cursor: pointer;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const Scroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
`

const HeadRow = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) minmax(120px, 1fr) 90px 80px 110px;
  background: var(--board-bg-raised);
  border-bottom: 1px solid var(--board-hairline);
`

const HeadCell = styled.div`
  padding: 7px 10px;
  color: var(--board-ink-dim);
  font-size: 11px;
  font-weight: 500;

  &.num {
    text-align: right;
  }
`

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) minmax(120px, 1fr) 90px 80px 110px;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
  }

  &[aria-pressed='true'] {
    background: var(--board-segment-selected-bg);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  &[aria-disabled='true'] {
    cursor: default;
    opacity: 0.75;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`

const ApiCell = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
`

const Cell = styled.div`
  padding: 7px 10px;
  font-size: 12px;
  color: var(--board-ink);

  &.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
`

const StatusCell = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-height: 34px;
  padding: 5px 10px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`

const Reason = styled.span`
  color: var(--board-ink-dim);
  cursor: help;
  text-decoration: underline dotted;
`

const RowTag = styled.span`
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--board-hairline);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 400;
  color: var(--board-ink-dim);
  flex: none;
`

const DownloadButton = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg-raised);
  color: var(--board-ink);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover {
    background: var(--board-hover-veil);
  }

  &[aria-disabled='true'] {
    cursor: default;
    opacity: 0.7;
  }
`

const EmptyHint = styled.p`
  margin: 0;
  padding: 16px 12px;
  font-size: 12px;
  color: var(--board-ink-dim);
`

const Legend = styled.p`
  margin: 0;
  flex: none;
  font-size: 11px;
  color: var(--board-ink-dim);
`

export default ImageTable

const UninstallButton = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* 两态同宽（删除 / spinner+删除中），行高不抖、文字不换行破版 */
  min-width: 72px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg-raised);
  color: var(--board-ink-dim);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    background: var(--board-hover-veil);
    color: var(--board-ink);
  }

  &[aria-disabled='true'] {
    cursor: default;
    opacity: 0.6;
  }
`

const UninstallSpinner = styled(Loader2)`
  color: var(--loading);
  animation: uninstall-spin 1.2s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes uninstall-spin {
    to {
      transform: rotate(360deg);
    }
  }
`
