import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import styled from 'styled-components'
import type { CreateDeviceInput, ImageVariant } from '@shared/types'
import Button from './Button'
import Input from './Input'

// ---- mock 目录（stage 04 换 avdmanager list device / sdkmanager 真数据） ----

interface MockProfile {
  id: string
  label: string
  resolution: string
}

const MOCK_PROFILES: MockProfile[] = [
  { id: 'pixel_8', label: 'Pixel 8', resolution: '1080×2400 · 420dpi' },
  { id: 'pixel_8_pro', label: 'Pixel 8 Pro', resolution: '1344×2992 · 480dpi' },
  { id: 'pixel_6a', label: 'Pixel 6a', resolution: '1080×2400 · 440dpi' },
  { id: 'pixel_tablet', label: 'Pixel Tablet', resolution: '1600×2560 · 276dpi' }
]

const VARIANT_LABELS: Record<ImageVariant, string> = {
  aosp: 'AOSP',
  google_apis: 'Google APIs',
  google_play: 'Google Play'
}

interface MockImage {
  apiLevel: number
  variant: ImageVariant
  size: string
}

const MOCK_IMAGES: MockImage[] = [
  { apiLevel: 35, variant: 'google_apis', size: '1.4 GB' },
  { apiLevel: 34, variant: 'google_play', size: '1.5 GB' },
  { apiLevel: 34, variant: 'google_apis', size: '1.3 GB' },
  { apiLevel: 33, variant: 'aosp', size: '1.2 GB' }
]

const STEP_TITLES: Record<1 | 2 | 3, string> = {
  1: '选择设备画像',
  2: '选择系统镜像',
  3: '命名设备'
}

type WizardVariant = 'panel' | 'window'

type DeviceWizardProps = {
  /** panel = 主窗右栏内嵌卡片；window = 原生模态子窗整页（Esc 关闭） */
  variant?: WizardVariant
  onCreate: (input: CreateDeviceInput) => void
  onCancel: () => void
}

/** 三步向导（画像 → 镜像 → 命名）：panel 占主窗画布区；window 填满模态子窗视口 */
const DeviceWizard = ({
  variant = 'panel',
  onCreate,
  onCancel
}: DeviceWizardProps): React.JSX.Element => {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [profile, setProfile] = useState<MockProfile | null>(null)
  const [image, setImage] = useState<MockImage | null>(null)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)

  // window 变体是独立窗体：焦点不在任何元素上时 Esc 也应能取消（panel 无此语义）
  useEffect(() => {
    if (variant !== 'window') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [variant, onCancel])

  const defaultName = profile && image ? `${profile.label} API ${image.apiLevel}` : ''
  const effectiveName = nameTouched ? name : defaultName
  const canCreate = effectiveName.trim().length > 0

  const goNext = (): void => {
    if (step === 1 && profile) setStep(2)
    else if (step === 2 && image) setStep(3)
  }

  const create = (): void => {
    if (!profile || !image || !canCreate) return
    onCreate({
      profileId: profile.id,
      profileLabel: profile.label,
      apiLevel: image.apiLevel,
      variant: image.variant,
      name: effectiveName.trim()
    })
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

      <Body>
        {step === 1 ? (
          <OptionGroup role="group" aria-label={STEP_TITLES[1]}>
            {MOCK_PROFILES.map((entry) => (
              <OptionButton
                key={entry.id}
                type="button"
                aria-pressed={profile?.id === entry.id}
                onClick={() => setProfile(entry)}
              >
                <OptionTitle>{entry.label}</OptionTitle>
                <OptionSub>{entry.resolution}</OptionSub>
              </OptionButton>
            ))}
          </OptionGroup>
        ) : step === 2 ? (
          <OptionGroup role="group" aria-label={STEP_TITLES[2]}>
            {MOCK_IMAGES.map((entry) => (
              <OptionButton
                key={`${entry.apiLevel}-${entry.variant}`}
                type="button"
                aria-pressed={
                  image?.apiLevel === entry.apiLevel && image?.variant === entry.variant
                }
                onClick={() => setImage(entry)}
              >
                <OptionTitle>
                  API {entry.apiLevel} · {VARIANT_LABELS[entry.variant]}
                </OptionTitle>
                <OptionSub>arm64-v8a · {entry.size}</OptionSub>
              </OptionButton>
            ))}
          </OptionGroup>
        ) : (
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
        )}
      </Body>

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
            disabled={(step === 1 && !profile) || (step === 2 && !image)}
            onClick={goNext}
          >
            下一步
          </Button>
        ) : (
          <Button variant="primary" disabled={!canCreate} onClick={create}>
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
        height: 100%;
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
