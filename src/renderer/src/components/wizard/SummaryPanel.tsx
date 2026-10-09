import styled from 'styled-components'
import type { CompatibilityVerdict } from '@shared/compatibility'
import type { DeviceProfile, ImageEntry } from '@shared/types'
import {
  FORM_FACTOR_LABELS,
  apiDisplay,
  apiRangeDisplay,
  formatSize,
  serviceLabels
} from './shared'

/** 配置页右侧固定摘要（约 210px）：画像与选中镜像的决策要点 */

export interface SummaryPanelProps {
  profile: DeviceProfile | null
  image: ImageEntry | null
  verdict: CompatibilityVerdict | null
}

const SummaryPanel = ({ profile, image, verdict }: SummaryPanelProps): React.JSX.Element => {
  const screen =
    profile !== null && (profile.screen.widthPx !== null || profile.screen.diagonalInches !== null)
      ? [
          profile.screen.diagonalInches !== null ? `${profile.screen.diagonalInches}"` : null,
          profile.screen.widthPx !== null && profile.screen.heightPx !== null
            ? `${profile.screen.widthPx}×${profile.screen.heightPx}`
            : null,
          profile.screen.logicalDpi !== null ? `${profile.screen.logicalDpi}dpi` : null
        ].filter((part): part is string => part !== null)
      : []

  return (
    <Wrapper aria-label="设备摘要">
      <section className="section">
        <h4 className="section-title">设备画像</h4>
        {profile === null ? (
          <span className="empty-line">未选择</span>
        ) : (
          <>
            <span className="name">{profile.name}</span>
            <span className="line">{profile.manufacturer ?? '厂商未知'}</span>
            <span className="line">
              {FORM_FACTOR_LABELS[profile.formFactor]}
              {screen.length > 0 ? ` · ${screen.join(' · ')}` : ''}
            </span>
            <span className="line">
              API {apiRangeDisplay(profile)}
              {profile.playSupported === true ? ' · Play' : ''}
            </span>
          </>
        )}
      </section>

      <section className="section">
        <h4 className="section-title">系统镜像</h4>
        {image === null ? (
          <span className="empty-line">未选择</span>
        ) : (
          <>
            <span className="name">API {apiDisplay(image)}</span>
            <span className="line">{serviceLabels(image).join(' + ')}</span>
            <span className="line">{image.abi}</span>
            <span className="line">
              {image.installed ? '已安装' : `下载 ${formatSize(image.sizeBytes)}`}
              {image.api.extensionLevel !== null ? ` · 扩展 ${image.api.extensionLevel}` : ''}
            </span>
            {verdict !== null && verdict.reasons.length > 0 ? (
              <ul className="reason-list">
                {verdict.reasons.map((reason) => (
                  <li className="reason-item" key={reason}>
                    {reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <p className="hint">
        附加设置在「附加设置」标签配置；未配置的项按镜像与画像默认值创建（Cold Boot、 host GPU）。
      </p>
    </Wrapper>
  )
}

const Wrapper = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 210px;
  flex: none;
  padding: 14px;
  border-left: 1px solid var(--board-hairline);
  overflow-y: auto;

  .section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-title {
    margin: 0 0 2px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--board-hairline);
    font-size: 11px;
    font-weight: 500;
    color: var(--board-ink-dim);
  }

  .name {
    font-size: 13px;
    font-weight: 600;
  }

  .line {
    font-size: 11px;
    line-height: 1.6;
    color: var(--board-ink-dim);
  }

  .empty-line {
    font-size: 11px;
    color: var(--board-ink-dim);
  }

  .reason-list {
    margin: 4px 0 0;
    padding-left: 14px;
  }

  .reason-item {
    font-size: 11px;
    line-height: 1.6;
    color: var(--board-ink-dim);
  }

  .hint {
    margin: auto 0 0;
    font-size: 10px;
    line-height: 1.6;
    color: var(--board-ink-dim);
  }
`

export default SummaryPanel
