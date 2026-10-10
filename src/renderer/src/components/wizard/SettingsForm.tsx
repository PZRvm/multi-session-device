import styled from 'styled-components'
import type {
  DeviceAdvancedSettings,
  GpuMode,
  SettingFieldCapability,
  WizardCapabilities
} from '@shared/types'
import { WIZARD_COPY, format } from '@shared/i18n'
import { useCopy } from '../../hooks/useCopy'
import { gpuLabels, networkDelayLabels, networkSpeedLabels } from './labels'

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
  /** 皮肤清单（DeviceWizard/DeviceEditor 拉取）；空 = 无可用皮肤 */
  skins: Array<{ skinRef: string; name: string; source: string }>
  /** 导入/下载触发（向导窗专用通道）；完成后清单由父层刷新 */
  onImportSkin: () => Promise<void>
  onDownloadSkin: (skinName: string) => Promise<void>
  skinDownloading: string | null
  skinError?: string | null
  cameraBusy?: boolean
  cameraError?: string | null
  onCameraAction?: (action: 'request' | 'refresh' | 'settings') => Promise<void>
  /** create（默认）= 创建表单；edit = 编辑已有设备（内部存储只读展示） */
  mode?: 'create' | 'edit'
  /** 编辑模式的内部存储展示文案（null = 容量未知） */
  storageDisplay?: string | null
}

const SettingsForm = ({
  capabilities,
  value,
  errors,
  onChange,
  skins,
  onImportSkin,
  onDownloadSkin,
  skinDownloading,
  skinError,
  cameraBusy,
  cameraError,
  onCameraAction,
  mode = 'create',
  storageDisplay = null
}: SettingsFormProps): React.JSX.Element => {
  const copy = useCopy(WIZARD_COPY)
  const field = (key: string): SettingFieldCapability | null => capabilities.fields[key] ?? null
  const disabledReasonOf = (key: string): string | null => field(key)?.disabledReason ?? null
  /** 摄像头选择：none/emulated/virtualScene + 枚举到的宿主 webcam（带权限归属说明）；
   *  尊重字段禁用态（review P1） */
  const cameraSelect = (
    key: 'frontCamera' | 'rearCamera',
    label: string,
    value: DeviceAdvancedSettings,
    onChange: (next: DeviceAdvancedSettings) => void,
    capabilities: WizardCapabilities
  ): React.JSX.Element => {
    const current = value[key]
    const disabledReason = capabilities.fields[key]?.disabledReason ?? null
    const disabled = disabledReason !== null
    const options: Array<{ value: string; label: string }> = [
      { value: 'emulated', label: copy.cameraEmulated },
      { value: 'none', label: copy.cameraOff },
      { value: 'virtualScene', label: copy.cameraVirtualScene },
      ...capabilities.webcamDeviceIds.map((id) => ({
        value: id,
        label:
          capabilities.cameraSnapshot?.devices.find((entry) => entry.id === id)?.name ??
          format(copy.webcamLabel, { id })
      }))
    ]
    return (
      <div className="field" data-disabled={disabled || undefined}>
        <label className="label" htmlFor={`setting-${key}`}>
          {label}
        </label>
        <select
          className="select"
          id={`setting-${key}`}
          disabled={disabled}
          value={current.mode === 'webcam' ? (current.deviceId ?? '') : current.mode}
          onChange={(event) => {
            const picked = event.target.value
            if (picked === 'none' || picked === 'emulated' || picked === 'virtualScene') {
              onChange({ ...value, [key]: { mode: picked, deviceId: null } })
            } else {
              onChange({
                ...value,
                [key]: {
                  mode: 'webcam',
                  deviceId: picked,
                  hostDeviceId: capabilities.cameraSnapshot?.devices.find(
                    (entry) => entry.id === picked
                  )?.deviceLabel
                }
              })
            }
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="hint">
          {disabled
            ? disabledReason
            : capabilities.webcamDeviceIds.length === 0
              ? (capabilities.cameraSnapshot?.error ?? copy.cameraNoDeviceHint)
              : copy.cameraSharedHint}
        </p>
      </div>
    )
  }
  const num = (
    key: keyof DeviceAdvancedSettings & string,
    label: string,
    unit: string
  ): React.JSX.Element => {
    const capability = field(key)
    const disabled = capability?.disabledReason !== null && capability?.disabledReason !== undefined
    const rangeMin = capability?.min
    const rangeMax = capability?.max
    const hint = disabled
      ? disabledReasonOf(key)
      : rangeMin !== null && rangeMin !== undefined
        ? format(copy.rangeHint, {
            min: String(rangeMin),
            max: String(rangeMax)
          })
        : null
    return (
      <div className="field" data-disabled={disabled || undefined}>
        <label className="label" htmlFor={`setting-${key}`}>
          {label}
          <span className="unit">{unit}</span>
        </label>
        <input
          className="num-input"
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
          <p className="field-error" role="alert">
            {errors[key]}
          </p>
        ) : hint !== null ? (
          <p className="hint">{hint}</p>
        ) : null}
      </div>
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
      <div className="field" data-disabled={disabled || undefined}>
        <label className="label" htmlFor={`setting-${key}`}>
          {label}
        </label>
        <select
          className="select"
          id={`setting-${key}`}
          value={currentValue ?? ''}
          disabled={disabled}
          onChange={(event) => {
            onPick((event.target.value === '' ? null : event.target.value) as T | null)
          }}
        >
          <option value="">{key === 'skinRef' ? copy.genericFrame : copy.followDefault}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {disabled ? <p className="hint">{disabledReasonOf(key)}</p> : null}
      </div>
    )
  }

  return (
    <Wrapper>
      <fieldset className="group">
        <legend className="group-title">{copy.groupSkin}</legend>
        {select(
          'skinRef',
          copy.fieldSkinRef,
          value.skinRef,
          skins.map((skin) => ({
            value: skin.skinRef,
            label: `${skin.name}（${
              (
                {
                  sdk: copy.skinSourceSdk,
                  imported: copy.skinSourceImported,
                  downloaded: copy.skinSourceDownloaded
                } as Record<string, string>
              )[skin.source] ?? skin.source
            }）`
          })),
          (next) => onChange({ ...value, skinRef: next })
        )}
        <div className="skin-actions">
          <button
            type="button"
            className="skin-button"
            disabled={skinDownloading !== null}
            onClick={() => void onImportSkin()}
          >
            {copy.importArchive}
          </button>
          {capabilities.recommendedSkin ? (
            <button
              type="button"
              className="skin-button"
              disabled={skinDownloading !== null}
              onClick={() => void onDownloadSkin(capabilities.recommendedSkin!.name)}
            >
              {skinDownloading !== null
                ? copy.fetching
                : format(copy.fetchOfficialSkin, { name: capabilities.recommendedSkin.name })}
            </button>
          ) : null}
        </div>
        <p className="hint">
          {capabilities.recommendedSkin ? copy.skinHintRecommended : copy.skinHintNone}
        </p>
        {skinError ? (
          <p className="field-error" role="alert">
            {skinError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">{copy.groupCamera}</legend>
        {cameraSelect('frontCamera', copy.fieldFrontCamera, value, onChange, capabilities)}
        {cameraSelect('rearCamera', copy.fieldRearCamera, value, onChange, capabilities)}
        {onCameraAction ? (
          <div className="skin-actions">
            {capabilities.cameraSnapshot?.permission === 'not-determined' ? (
              <button
                disabled={cameraBusy}
                type="button"
                className="skin-button"
                onClick={() => void onCameraAction('request')}
              >
                {copy.requestCamera}
              </button>
            ) : null}
            {['denied', 'restricted'].includes(capabilities.cameraSnapshot?.permission ?? '') ? (
              <button
                disabled={cameraBusy}
                type="button"
                className="skin-button"
                onClick={() => void onCameraAction('settings')}
              >
                {copy.openCameraSettings}
              </button>
            ) : null}
            <button
              disabled={cameraBusy}
              type="button"
              className="skin-button"
              onClick={() => void onCameraAction('refresh')}
            >
              {cameraBusy ? copy.checking : copy.refreshCamera}
            </button>
          </div>
        ) : null}
        {['denied', 'restricted'].includes(capabilities.cameraSnapshot?.permission ?? '') ? (
          <p className="hint">{copy.cameraDeniedHint}</p>
        ) : null}
        {cameraError ? (
          <p className="field-error" role="alert">
            {cameraError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">{copy.groupNetwork}</legend>
        {select(
          'networkSpeed',
          copy.fieldNetworkSpeed,
          value.networkSpeed,
          networkSpeedLabels(copy).map(([preset, label]) => ({ value: preset, label })),
          (next) => onChange({ ...value, networkSpeed: next })
        )}
        {select(
          'networkLatency',
          copy.fieldNetworkLatency,
          value.networkLatency,
          networkDelayLabels(copy).map(([preset, label]) => ({ value: preset, label })),
          (next) => onChange({ ...value, networkLatency: next })
        )}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">{copy.groupBoot}</legend>
        <div className="field" data-disabled={!capabilities.quickBootAvailable || undefined}>
          <label className="label">{copy.fieldBootMode}</label>
          <div className="radio-row" role="radiogroup" aria-label={copy.fieldBootMode}>
            <label className="radio-label">
              <input
                type="radio"
                name="setting-boot-mode"
                checked={value.bootMode === 'cold'}
                onChange={() => onChange({ ...value, bootMode: 'cold' })}
              />
              {copy.bootCold}
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="setting-boot-mode"
                checked={value.bootMode === 'quick'}
                disabled={!capabilities.quickBootAvailable}
                onChange={() => {
                  if (capabilities.quickBootAvailable) onChange({ ...value, bootMode: 'quick' })
                }}
              />
              {copy.bootQuick}
            </label>
          </div>
          <p className="hint">
            {capabilities.quickBootAvailable
              ? copy.bootQuickHint
              : capabilities.quickBootDisabledReason}
          </p>
        </div>
        {select(
          'orientation',
          copy.fieldOrientation,
          value.orientation,
          [
            { value: 'portrait' as const, label: copy.orientationPortrait },
            { value: 'landscape' as const, label: copy.orientationLandscape }
          ],
          (next) => onChange({ ...value, orientation: next })
        )}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">{copy.groupStorage}</legend>
        {mode === 'edit' ? (
          <div className="field" data-disabled>
            <label className="label" htmlFor="setting-internal-storage-edit">
              {copy.userdataCapacity}
            </label>
            <input
              className="num-input"
              id="setting-internal-storage-edit"
              disabled
              readOnly
              aria-readonly="true"
              value={storageDisplay ?? String(value.internalStorageMiB)}
            />
            <p className="hint">{copy.storageFixedHint}</p>
          </div>
        ) : (
          num('internalStorageMiB', copy.userdataInitial, 'MiB')
        )}
        {mode === 'create' ? <p className="hint">{copy.storageDefaultHint}</p> : null}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">{copy.groupPerformance}</legend>
        {num('cpuCores', copy.fieldCpuCores, copy.unitCores)}
        {num('ramMiB', copy.fieldRam, 'MiB')}
        {num('vmHeapMiB', copy.fieldVmHeap, 'MiB')}
        {select(
          'graphics',
          copy.fieldGraphics,
          value.graphics === 'auto' ? null : value.graphics,
          gpuLabels(copy).map(([mode, label]) => ({ value: mode, label })),
          (next) => onChange({ ...value, graphics: (next ?? 'auto') as GpuMode })
        )}
        {select(
          'preferredAbi',
          copy.fieldPreferredAbi,
          value.preferredAbi === 'optimal' ? null : value.preferredAbi,
          [{ value: 'arm64-v8a' as const, label: 'arm64-v8a' }],
          (next) => onChange({ ...value, preferredAbi: next ?? 'optimal' })
        )}
        <p className="hint">{copy.abiHint}</p>
      </fieldset>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  padding: 14px 16px;

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: none;
  }

  .group-title {
    padding: 0;
    margin-bottom: 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--board-ink-dim);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field[data-disabled] {
    opacity: 0.6;
  }

  .label {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12px;
    color: var(--board-ink);
  }

  .unit {
    font-size: 10px;
    color: var(--board-ink-dim);
  }

  .num-input {
    width: 160px;
    padding: 5px 8px;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: var(--board-bg);
    color: var(--board-ink);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .num-input:disabled {
    cursor: default;
  }

  .num-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .num-input[aria-invalid='true'] {
    border-color: var(--danger, #b3261e);
  }

  .select {
    width: 200px;
    padding: 5px 8px;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: var(--board-bg);
    color: var(--board-ink);
    font-size: 12px;
  }

  .select:disabled {
    cursor: default;
  }

  .select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .radio-row {
    display: flex;
    gap: 14px;
  }

  .radio-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    cursor: pointer;
  }

  .hint {
    margin: 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--board-ink-dim);
  }

  .field-error {
    margin: 0;
    font-size: 11px;
    color: var(--danger, #b3261e);
  }

  .skin-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }

  .skin-button {
    padding: 5px 10px;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: var(--board-bg-raised);
    color: var(--board-ink);
    font-size: 11px;
    cursor: pointer;
  }

  .skin-button:hover:not(:disabled) {
    background: var(--board-hover-veil);
  }

  .skin-button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .skin-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

export default SettingsForm
