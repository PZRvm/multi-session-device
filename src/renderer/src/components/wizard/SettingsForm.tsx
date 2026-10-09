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

/** 摄像头选择：none/emulated/virtualScene + 枚举到的宿主 webcam（带权限归属说明）；尊重字段禁用态（review P1） */
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
    { value: 'emulated', label: '模拟画面' },
    { value: 'none', label: '关闭' },
    { value: 'virtualScene', label: '虚拟场景' },
    ...capabilities.webcamDeviceIds.map((id) => ({
      value: id,
      label:
        capabilities.cameraSnapshot?.devices.find((entry) => entry.id === id)?.name ??
        `真实摄像头 ${id}`
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
            ? (capabilities.cameraSnapshot?.error ?? '未枚举到宿主摄像头，请刷新或检查权限')
            : '同一摄像头不能同时配给两台设备；macOS 权限归属本应用'}
      </p>
    </div>
  )
}

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
  const field = (key: string): SettingFieldCapability | null => capabilities.fields[key] ?? null
  const disabledReasonOf = (key: string): string | null => field(key)?.disabledReason ?? null
  const num = (
    key: keyof DeviceAdvancedSettings & string,
    label: string,
    unit: string
  ): React.JSX.Element => {
    const capability = field(key)
    const disabled = capability?.disabledReason !== null && capability?.disabledReason !== undefined
    const hint = disabled
      ? disabledReasonOf(key)
      : capability?.min !== null && capability?.min !== undefined
        ? `范围 ${capability.min}–${capability.max}`
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
          <option value="">{key === 'skinRef' ? '通用外框' : '跟随默认'}</option>
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
        <legend className="group-title">皮肤</legend>
        {select(
          'skinRef',
          '机型皮肤',
          value.skinRef,
          skins.map((skin) => ({
            value: skin.skinRef,
            label: `${skin.name}（${({ sdk: '本机 SDK', imported: '已导入', downloaded: '官方缓存' } as Record<string, string>)[skin.source] ?? skin.source}）`
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
            导入压缩包…
          </button>
          {capabilities.recommendedSkin ? (
            <button
              type="button"
              className="skin-button"
              disabled={skinDownloading !== null}
              onClick={() => void onDownloadSkin(capabilities.recommendedSkin!.name)}
            >
              {skinDownloading !== null
                ? '正在获取…'
                : `获取 ${capabilities.recommendedSkin.name} 官方皮肤`}
            </button>
          ) : null}
        </div>
        <p className="hint">
          {capabilities.recommendedSkin
            ? '已缓存的对应机型皮肤默认选中；未选择时使用通用外框。'
            : '该机型暂无已核实的官方皮肤；可使用通用外框或导入压缩包。'}
        </p>
        {skinError ? (
          <p className="field-error" role="alert">
            {skinError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">摄像头</legend>
        {cameraSelect('frontCamera', '前置摄像头', value, onChange, capabilities)}
        {cameraSelect('rearCamera', '后置摄像头', value, onChange, capabilities)}
        {onCameraAction ? (
          <div className="skin-actions">
            {capabilities.cameraSnapshot?.permission === 'not-determined' ? (
              <button
                disabled={cameraBusy}
                type="button"
                className="skin-button"
                onClick={() => void onCameraAction('request')}
              >
                允许使用摄像头
              </button>
            ) : null}
            {['denied', 'restricted'].includes(capabilities.cameraSnapshot?.permission ?? '') ? (
              <button
                disabled={cameraBusy}
                type="button"
                className="skin-button"
                onClick={() => void onCameraAction('settings')}
              >
                打开摄像头权限设置
              </button>
            ) : null}
            <button
              disabled={cameraBusy}
              type="button"
              className="skin-button"
              onClick={() => void onCameraAction('refresh')}
            >
              {cameraBusy ? '正在检查…' : '刷新摄像头'}
            </button>
          </div>
        ) : null}
        {['denied', 'restricted'].includes(capabilities.cameraSnapshot?.permission ?? '') ? (
          <p className="hint">系统未允许本应用使用摄像头。修改系统权限后请重启应用。</p>
        ) : null}
        {cameraError ? (
          <p className="field-error" role="alert">
            {cameraError}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">网络</legend>
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
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">启动</legend>
        <div className="field" data-disabled={!capabilities.quickBootAvailable || undefined}>
          <label className="label">启动模式</label>
          <div className="radio-row" role="radiogroup" aria-label="启动模式">
            <label className="radio-label">
              <input
                type="radio"
                name="setting-boot-mode"
                checked={value.bootMode === 'cold'}
                onChange={() => onChange({ ...value, bootMode: 'cold' })}
              />
              Cold Boot（全新启动）
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
              Quick Boot
            </label>
          </div>
          <p className="hint">
            {capabilities.quickBootAvailable
              ? 'Quick 恢复上次快照；配置或镜像变化后自动回冷启动'
              : capabilities.quickBootDisabledReason}
          </p>
        </div>
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
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">内部存储</legend>
        {mode === 'edit' ? (
          <div className="field" data-disabled>
            <label className="label" htmlFor="setting-internal-storage-edit">
              userdata 容量
            </label>
            <input
              className="num-input"
              id="setting-internal-storage-edit"
              disabled
              readOnly
              aria-readonly="true"
              value={storageDisplay ?? String(value.internalStorageMiB)}
            />
            <p className="hint">已有模拟器不支持修改内部存储，容量保持原配置。</p>
          </div>
        ) : (
          num('internalStorageMiB', 'userdata 初始容量', 'MiB')
        )}
        {mode === 'create' ? (
          <p className="hint">默认 6144 MiB（6 GB，按 1024 换算）；创建后不可扩容。</p>
        ) : null}
      </fieldset>

      <fieldset className="group">
        <legend className="group-title">模拟性能</legend>
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
        <p className="hint">Optimal 解析为所选镜像 ABI（本期 arm64）。软件渲染性能低于硬件加速。</p>
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
