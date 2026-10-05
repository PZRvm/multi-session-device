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
    <Aside aria-label="设备摘要">
      <Section>
        <SectionTitle>设备画像</SectionTitle>
        {profile === null ? (
          <EmptyLine>未选择</EmptyLine>
        ) : (
          <>
            <Name>{profile.name}</Name>
            <Line>{profile.manufacturer ?? '厂商未知'}</Line>
            <Line>
              {FORM_FACTOR_LABELS[profile.formFactor]}
              {screen.length > 0 ? ` · ${screen.join(' · ')}` : ''}
            </Line>
            <Line>
              API {apiRangeDisplay(profile)}
              {profile.playSupported === true ? ' · Play' : ''}
            </Line>
          </>
        )}
      </Section>

      <Section>
        <SectionTitle>系统镜像</SectionTitle>
        {image === null ? (
          <EmptyLine>未选择</EmptyLine>
        ) : (
          <>
            <Name>API {apiDisplay(image)}</Name>
            <Line>{serviceLabels(image).join(' + ')}</Line>
            <Line>{image.abi}</Line>
            <Line>
              {image.installed ? '已安装' : `下载 ${formatSize(image.sizeBytes)}`}
              {image.api.extensionLevel !== null ? ` · 扩展 ${image.api.extensionLevel}` : ''}
            </Line>
            {verdict !== null && verdict.reasons.length > 0 ? (
              <ReasonList>
                {verdict.reasons.map((reason) => (
                  <ReasonItem key={reason}>{reason}</ReasonItem>
                ))}
              </ReasonList>
            ) : null}
          </>
        )}
      </Section>

      <Hint>
        附加设置在「附加设置」标签配置；未配置的项按镜像与画像默认值创建（Cold Boot、 host GPU）。
      </Hint>
    </Aside>
  )
}

const Aside = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 210px;
  flex: none;
  padding: 14px;
  border-left: 1px solid var(--board-hairline);
  overflow-y: auto;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const SectionTitle = styled.h4`
  margin: 0 0 2px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--board-hairline);
  font-size: 11px;
  font-weight: 500;
  color: var(--board-ink-dim);
`

const Name = styled.span`
  font-size: 13px;
  font-weight: 600;
`

const Line = styled.span`
  font-size: 11px;
  line-height: 1.6;
  color: var(--board-ink-dim);
`

const EmptyLine = styled.span`
  font-size: 11px;
  color: var(--board-ink-dim);
`

const ReasonList = styled.ul`
  margin: 4px 0 0;
  padding-left: 14px;
`

const ReasonItem = styled.li`
  font-size: 11px;
  line-height: 1.6;
  color: var(--board-ink-dim);
`

const Hint = styled.p`
  margin: auto 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--board-ink-dim);
`

export default SummaryPanel
