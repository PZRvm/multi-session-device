import styled from 'styled-components'
import type {
  DeviceAdvancedSettings,
  GpuMode,
  SettingFieldCapability,
  WizardCapabilities
} from '@shared/types'
import { NETWORK_SPEED_LABELS, NETWORK_DELAY_LABELS, GPU_LABELS } from './labels'

/**
 * 附加设置表单（plan 设计 3/4）：按皮肤/摄像头/网络/启动/内部存储/模拟性能分组。
 * 控件旁说明单位与限制；禁用字段显示能力原因（main 的 WizardCapabilities）。
 * 值变更走 onChange（整对象上抛）；校验错误定位到字段（红边 + 文案）。
 */

export interface SettingsFormProps {
  capabilities: WizardCapabilities
  value: DeviceAdvancedSettings
  errors: Record<string, string>
  onChange: (next: DeviceAdvancedSettings) => void
}

const SettingsForm = ({
  capabilities,
  value,
  errors,
  onChange
}: SettingsFormProps): React.JSX.Element => {
  const field = (key: string): SettingFieldCapability | null => capabilities.fields[key] ?? null
  const disabledReasonOf = (key: string): string | null => field(key)?.disabledReason ?? null
  const num = (
    key: keyof DeviceAdvancedSettings & string,
    label: string,
    unit: string
  ): React.JSX.Element => {
    const capability = field(key)
    const disabled = capability?.disabledReason !== null && capability?.disabledReason !== undefined
    return (
      <Field disabled={disabled}>
        <Label htmlFor={`setting-${key}`}>
          {label}
          <Unit>{unit}</Unit>
        </Label>
        <NumInput
          id={`setting-${key}`}
          type="number"
          value={String(value[key])}
          min={capability?.min ?? undefined}
          max={capability?.max ?? undefined}
          step={capability?.step ?? undefined}
          disabled={disabled}
          aria-invalid={errors[key] !== undefined}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            onChange({ ...value, [key]: Number.isFinite(parsed) ? parsed : value[key] })
          }}
        />
        {errors[key] !== undefined ? (
          <FieldError role="alert">{errors[key]}</FieldError>
        ) : (
          <Hint>
            {disabled
              ? disabledReasonOf(key)
              : capability?.min !== null && capability?.min !== undefined
                ? `范围 ${capability.min}–${capability.max}`
                : ''}
          </Hint>
        )}
      </Field>
    )
  }

  const select = <T extends string>(
    key: string,
    label: string,
    currentValue: T | null,
    options: Array<{ value: T; label: string }>,
    onPick: (next: T | null) => void
  ): React.JSX.Element => {
    const disabled = disabledReasonOf(key) !== null
    return (
      <Field disabled={disabled}>
        <Label htmlFor={`setting-${key}`}>{label}</Label>
        <Select
          id={`setting-${key}`}
          value={currentValue ?? ''}
          disabled={disabled}
          onChange={(event) => {
            onPick((event.target.value === '' ? null : event.target.value) as T | null)
          }}
        >
          <option value="">跟随默认</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Hint>{disabled ? disabledReasonOf(key) : ''}</Hint>
      </Field>
    )
  }

  return (
    <Form>
      <Group>
        <GroupTitle>皮肤</GroupTitle>
        <Hint>{disabledReasonOf('skinRef') ?? '未选择时使用通用外框'}</Hint>
      </Group>

      <Group>
        <GroupTitle>摄像头</GroupTitle>
        {select(
          'frontCamera',
          '前置摄像头',
          value.frontCamera.mode === 'emulated' ? null : value.frontCamera.mode,
          [
            { value: 'none', label: '关闭' },
            { value: 'emulated', label: '模拟画面' },
            { value: 'virtualScene', label: '虚拟场景' }
          ],
          (next) =>
            onChange({
              ...value,
              frontCamera: { mode: next ?? 'emulated', deviceId: null }
            })
        )}
        {select(
          'rearCamera',
          '后置摄像头',
          value.rearCamera.mode === 'emulated' ? null : value.rearCamera.mode,
          [
            { value: 'none', label: '关闭' },
            { value: 'emulated', label: '模拟画面' },
            { value: 'virtualScene', label: '虚拟场景' }
          ],
          (next) =>
            onChange({
              ...value,
              rearCamera: { mode: next ?? 'emulated', deviceId: null }
            })
        )}
      </Group>

      <Group>
        <GroupTitle>网络</GroupTitle>
        {select(
          'networkSpeed',
          '网络速度',
          value.networkSpeed,
          NETWORK_SPEED_LABELS.map(([preset, label]) => ({ value: preset, label })),
          (next) => onChange({ ...value, networkSpeed: next })
        )}
        {select(
          'networkLatency',
          '网络延迟',
          value.networkLatency,
          NETWORK_DELAY_LABELS.map(([preset, label]) => ({ value: preset, label })),
          (next) => onChange({ ...value, networkLatency: next })
        )}
      </Group>

      <Group>
        <GroupTitle>启动</GroupTitle>
        <Field disabled={!capabilities.quickBootAvailable}>
          <Label>启动模式</Label>
          <RadioRow role="radiogroup" aria-label="启动模式">
            <RadioLabel>
              <input
                type="radio"
                name="setting-boot-mode"
                checked={value.bootMode === 'cold'}
                onChange={() => onChange({ ...value, bootMode: 'cold' })}
              />
              Cold Boot（全新启动）
            </RadioLabel>
            <RadioLabel>
              <input
                type="radio"
                name="setting-boot-mode"
                checked={value.bootMode === 'quick'}
                disabled={!capabilities.quickBootAvailable}
                onChange={() => {
                  if (capabilities.quickBootAvailable) onChange({ ...value, bootMode: 'quick' })
                }}
              />
              Quick Boot
            </RadioLabel>
          </RadioRow>
          <Hint>
            {capabilities.quickBootAvailable
              ? 'Quick 恢复上次快照；配置或镜像变化后自动回冷启动'
              : capabilities.quickBootDisabledReason}
          </Hint>
        </Field>
        {select(
          'orientation',
          '初始朝向',
          value.orientation,
          [
            { value: 'portrait' as const, label: '竖屏' },
            { value: 'landscape' as const, label: '横屏' }
          ],
          (next) => onChange({ ...value, orientation: next })
        )}
      </Group>

      <Group>
        <GroupTitle>内部存储</GroupTitle>
        {num('internalStorageMiB', 'userdata 初始容量', 'MiB')}
        <Hint>默认 6144 MiB（6 GB，按 1024 换算）；创建后不可扩容。</Hint>
      </Group>

      <Group>
        <GroupTitle>模拟性能</GroupTitle>
        {num('cpuCores', 'CPU 核数', '核')}
        {num('ramMiB', '内存（整机 RAM）', 'MiB')}
        {num('vmHeapMiB', 'VM heap', 'MiB')}
        {select(
          'graphics',
          'GPU 渲染',
          value.graphics === 'auto' ? null : value.graphics,
          GPU_LABELS.map(([mode, label]) => ({ value: mode, label })),
          (next) => onChange({ ...value, graphics: (next ?? 'auto') as GpuMode })
        )}
        {select(
          'preferredAbi',
          '应用 ABI',
          value.preferredAbi === 'optimal' ? null : value.preferredAbi,
          [{ value: 'arm64-v8a' as const, label: 'arm64-v8a' }],
          (next) => onChange({ ...value, preferredAbi: next ?? 'optimal' })
        )}
        <Hint>Optimal 解析为所选镜像 ABI（本期 arm64）。软件渲染性能低于硬件加速。</Hint>
      </Group>
    </Form>
  )
}

const Form = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  padding: 14px 16px;
`

const Group = styled.fieldset`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: none;
`

const GroupTitle = styled.legend`
  padding: 0;
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--board-ink-dim);
`

const Field = styled.div<{ disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;

  &[disabled] {
    opacity: 0.6;
  }
`

const Label = styled.label`
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  color: var(--board-ink);
`

const Unit = styled.span`
  font-size: 10px;
  color: var(--board-ink-dim);
`

const NumInput = styled.input`
  width: 160px;
  padding: 5px 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
  color: var(--board-ink);
  font-size: 12px;
  font-variant-numeric: tabular-nums;

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  &[aria-invalid='true'] {
    border-color: var(--danger, #b3261e);
  }
`

const Select = styled.select`
  width: 200px;
  padding: 5px 8px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
  color: var(--board-ink);
  font-size: 12px;

  &:disabled {
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const RadioRow = styled.div`
  display: flex;
  gap: 14px;
`

const RadioLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  cursor: pointer;
`

const Hint = styled.p`
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--board-ink-dim);
`

const FieldError = styled.p`
  margin: 0;
  font-size: 11px;
  color: var(--danger, #b3261e);
`

export default SettingsForm
