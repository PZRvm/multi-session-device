import { useEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import type {
  DeviceAdvancedSettings,
  DeviceEditSnapshot,
  DeviceConfigMismatch,
  DeviceStatus,
  StoreHealthState,
  UpdateDeviceInput,
  UpdateDeviceSettings
} from '@shared/types'
import { WIZARD_COPY, format } from '@shared/i18n'
import { EDITABLE_SETTING_KEYS, normalizeEditedSettings } from '@shared/settings-contract'
import { toApiResult } from '../api'
import Button from './Button'
import Input from './Input'
import SettingsForm from './wizard/SettingsForm'
import { useWizardResources } from './wizard/useWizardResources'
import { useCopy } from '../hooks/useCopy'
import { useLocaleStore } from '../stores/localeStore'
import { formFactorLabel, messageOf } from './wizard/shared'

/**
 * 已有设备配置编辑页（plan 2026-10-08 设计 4）：顶部名称 + 机型/API 只读上下文，
 * 下方共用 SettingsForm。运行中可查看（保存按钮禁用并说明），保存要求停止；
 * 无改动且无配置偏差时禁用保存；成功后本窗关闭、主窗经 devices:changed 同 id 更新。
 * 草稿只在本组件持有——资源刷新/能力更新不重置草稿，冲突需重新读取时由用户
 * 关闭重开（main 侧指纹复验兜底）。
 */

/** 只提交白名单字段的变化和待同步项（存储/ABI 永不进入载荷）。 */
const buildSettingsDiff = (
  original: DeviceAdvancedSettings,
  draft: DeviceAdvancedSettings,
  mismatches: DeviceConfigMismatch[] = []
): UpdateDeviceSettings => {
  const diff: UpdateDeviceSettings = {}
  for (const key of EDITABLE_SETTING_KEYS) {
    if (
      mismatches.some((item) => item.field === key) ||
      JSON.stringify(original[key]) !== JSON.stringify(draft[key])
    ) {
      ;(diff as Record<string, unknown>)[key] = draft[key]
    }
  }
  return diff
}

const statusBlockLabel = (
  status: DeviceStatus,
  copy: Pick<
    (typeof WIZARD_COPY)['zh-CN'],
    'editorSaveBlockedRunning' | 'editorSaveBlockedStopping' | 'editorSaveBlockedTransaction'
  >
): string => {
  if (status === 'running' || status === 'starting') return copy.editorSaveBlockedRunning
  if (status === 'stopping') return copy.editorSaveBlockedStopping
  return copy.editorSaveBlockedTransaction
}

type EditorPhase = 'loading' | 'ready' | 'error'

interface DeviceEditorProps {
  deviceId: string
  onCancel: () => void
  /** 读取注入（测试用）；缺省走 window.api.devices.readConfig */
  onLoadSnapshot?: (deviceId: string) => Promise<DeviceEditSnapshot>
  /** 保存注入（测试用）；缺省走 window.api.devices.updateConfig */
  onSave?: (input: UpdateDeviceInput) => Promise<void>
}

const DeviceEditor = ({
  deviceId,
  onCancel,
  onLoadSnapshot,
  onSave
}: DeviceEditorProps): React.JSX.Element => {
  const [phase, setPhase] = useState<EditorPhase>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<DeviceEditSnapshot | null>(null)
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<DeviceAdvancedSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resetCutout, setResetCutout] = useState(false)
  const [live, setLive] = useState<{
    status: DeviceStatus
    storeState: StoreHealthState
  } | null>(null)
  const [deviceMissing, setDeviceMissing] = useState(false)
  const generationRef = useRef(0)
  const savingRef = useRef(false)
  const copy = useCopy(WIZARD_COPY)
  const locale = useLocaleStore((state) => state.locale)
  const fieldLabels: Record<string, string> = useMemo(
    () => ({
      skinRef: copy.fieldSkinRef,
      frontCamera: copy.fieldFrontCamera,
      rearCamera: copy.fieldRearCamera,
      networkSpeed: copy.fieldNetworkSpeed,
      networkLatency: copy.fieldNetworkLatency,
      orientation: copy.fieldOrientation,
      bootMode: copy.fieldBootMode,
      internalStorageMiB: copy.fieldInternalStorage,
      cpuCores: copy.fieldCpuCores,
      graphics: copy.fieldGraphics,
      ramMiB: copy.fieldRam,
      vmHeapMiB: copy.fieldVmHeap,
      preferredAbi: copy.fieldPreferredAbi
    }),
    [copy]
  )

  const resources = useWizardResources({
    currentGeneration: () => generationRef.current,
    onSkinAdded: (skinRef) => setSettings((prev) => (prev === null ? prev : { ...prev, skinRef }))
  })

  const load = async (): Promise<void> => {
    const generation = ++generationRef.current
    setPhase('loading')
    setLoadError(null)
    try {
      let result: DeviceEditSnapshot
      if (onLoadSnapshot !== undefined) {
        result = await onLoadSnapshot(deviceId)
      } else {
        const response = await toApiResult(window.api.devices.readConfig(deviceId))
        if (!response.ok) throw new Error(response.error)
        result = response.data
      }
      if (generation !== generationRef.current) return
      setSnapshot(result)
      setName(result.identity.name)
      setSettings(result.settings)
      setPhase('ready')
    } catch (error) {
      if (generation !== generationRef.current) return
      setLoadError(messageOf(error))
      setPhase('error')
    }
  }

  useEffect(() => {
    // 初载即 loading 态（state 初值）；load 开头的同步 setPhase 只在重试按钮路径
    // 产生一次视觉复位——与 DeviceWizard 的依赖驱动重置同口径
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deviceId 固定（窗口上下文），重读只经按钮
  }, [deviceId])

  // 设备运行态订阅：被删/运行/停止中即时禁用保存；不自动刷新覆盖草稿
  useEffect(() => {
    if (!window.api?.devices?.onChanged) return
    return window.api.devices.onChanged((push) => {
      const device = push.devices.find((entry) => entry.id === deviceId)
      if (device === undefined) {
        setDeviceMissing(true)
        return
      }
      setDeviceMissing(false)
      setLive({ status: device.status, storeState: push.storeHealth.state })
    })
  }, [deviceId])

  // 独立窗体：Esc 关闭（与创建向导同口径）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onCancel])

  // 就绪后拉一次皮肤清单（只更新枚举，不碰草稿；依赖用稳定引用防循环）
  useEffect(() => {
    if (phase === 'ready') void resources.reloadSkins()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloadSkins 是 useCallback([]) 稳定引用
  }, [phase, resources.reloadSkins])

  const effectiveCapabilities = useMemo(
    () => resources.mergeOverlay(snapshot?.capabilities ?? null),
    [snapshot, resources]
  )

  // 本地与 main 共用差异校验，未修改且无偏差的旧字段不参与创建归一化。
  const settingsCheck = useMemo(
    () =>
      effectiveCapabilities === null || settings === null || snapshot?.settings == null
        ? { errors: {} as Record<string, string> }
        : normalizeEditedSettings(
            snapshot.settings,
            buildSettingsDiff(snapshot.settings, settings, snapshot.configMismatches),
            effectiveCapabilities,
            snapshot.configMismatches?.map((item) => item.field),
            locale
          ),
    [effectiveCapabilities, settings, snapshot, locale]
  )
  const errors = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(settingsCheck.errors).filter(([key]) => key !== 'internalStorageMiB')
      ),
    [settingsCheck]
  )

  const nameChanged =
    snapshot !== null && name.trim() !== snapshot.identity.name && name.trim().length > 0
  const settingsDiff =
    snapshot?.settings != null && settings !== null
      ? buildSettingsDiff(snapshot.settings, settings, snapshot.configMismatches)
      : {}
  const settingsChanged = Object.keys(settingsDiff).length > 0

  const liveBlockedReason = deviceMissing
    ? copy.editorDeviceMissing
    : (live?.status ?? snapshot?.status ?? 'stopped') !== 'stopped'
      ? statusBlockLabel(live?.status ?? snapshot!.status!, copy)
      : live !== null && live.storeState !== 'ok'
        ? copy.editorStoreRestricted
        : null
  const blockedReason = liveBlockedReason ?? snapshot?.saveBlockedReason ?? null

  const canSave =
    phase === 'ready' &&
    (nameChanged || settingsChanged || resetCutout) &&
    Object.keys(errors).length === 0 &&
    !saving &&
    blockedReason === null

  const save = async (): Promise<void> => {
    if (!canSave || savingRef.current || snapshot === null) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    try {
      const input: UpdateDeviceInput = { id: deviceId, fingerprint: snapshot.fingerprint }
      if (nameChanged) input.name = name.trim()
      if (settingsChanged) input.advancedSettings = settingsDiff
      if (resetCutout) input.resetDisplayCutout = true
      if (onSave !== undefined) {
        await onSave(input)
      } else {
        const result = await toApiResult(window.api.devices.updateConfig(input))
        if (!result.ok) {
          setSaveError(result.error)
          return
        }
      }
      // 成功：主窗列表经 devices:changed 同 id 更新，本窗关闭
      await toApiResult(window.api.wizard.close())
    } catch (error) {
      setSaveError(messageOf(error))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const warnings = useMemo(() => {
    if (snapshot === null) return [] as Array<[string, string]>
    return Object.entries(snapshot.fieldNotes)
      .filter(
        ([field, note]) =>
          note.warning !== null && !snapshot.configMismatches?.some((item) => item.field === field)
      )
      .map(([field, note]) => [fieldLabels[field] ?? field, note.warning as string])
  }, [snapshot, fieldLabels])

  const identityLine =
    snapshot !== null
      ? `${snapshot.identity.profileLabel} · API ${snapshot.identity.apiDisplay ?? '?'} · ${
          formFactorLabel(copy, snapshot.identity.formFactor) ?? snapshot.identity.formFactor
        }`
      : ''

  return (
    <Wrapper>
      <header className="header">
        <span className="traffic-spacer" aria-hidden="true" />
        <div className="title-group">
          <h3 className="heading">{copy.editorHeading}</h3>
          <span className="step-indicator">{copy.editorStepIndicator}</span>
        </div>
      </header>

      <div className="body">
        {phase === 'loading' ? (
          <p className="hint-pane">{copy.editorLoading}</p>
        ) : phase === 'error' ? (
          <p className="hint-pane">
            {format(copy.editorLoadFailed, { message: loadError ?? '' })}
            <br />
            <Button onClick={() => void load()}>{copy.retry}</Button>
          </p>
        ) : snapshot !== null ? (
          <div className="settings-pane">
            <div className="name-block">
              <label className="name-label" htmlFor="editor-device-name">
                {copy.nameLabel}
              </label>
              <Input
                id="editor-device-name"
                value={name}
                maxLength={50}
                onChange={(event) => setName(event.target.value)}
              />
              <p className="identity-line">{identityLine}</p>
              <p className="identity-line identity-line-small">
                {format(copy.editorStorageLine, {
                  value:
                    snapshot.internalStorage.valueMiB === null
                      ? copy.storageUnknown
                      : `${snapshot.internalStorage.valueMiB} MiB`,
                  note: snapshot.internalStorage.note
                })}
              </p>
              <label className="cutout-reset">
                <input
                  type="checkbox"
                  checked={resetCutout}
                  onChange={(event) => setResetCutout(event.target.checked)}
                />
                {copy.cutoutReset}
              </label>
            </div>

            {warnings.length > 0 || (snapshot.configMismatches?.length ?? 0) > 0 ? (
              <div className="notice-box" role="status">
                {snapshot.configMismatches?.map((item) => {
                  const adopted =
                    item.actualSettings !== null &&
                    settings !== null &&
                    Object.entries(item.actualSettings).every(
                      ([key, value]) =>
                        JSON.stringify(settings[key as keyof DeviceAdvancedSettings]) ===
                        JSON.stringify(value)
                    )
                  return (
                    <div className="config-mismatch" key={item.field}>
                      <span className="notice-line">
                        {fieldLabels[item.field]}：
                        {adopted
                          ? format(copy.mismatchAdopted, { label: String(item.actualLabel) })
                          : `${format(copy.mismatchPending, { label: String(item.actualLabel) })}${item.actualSettings === null ? copy.mismatchUnrecognized : ''}`}
                      </span>
                      {item.actualSettings !== null && settings !== null ? (
                        <Button
                          aria-label={format(copy.adoptAria, { field: fieldLabels[item.field] })}
                          disabled={saving || adopted}
                          onClick={() => {
                            setSettings((current) =>
                              current === null ? null : { ...current, ...item.actualSettings }
                            )
                          }}
                        >
                          {adopted ? copy.adopted : copy.adopt}
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
                {warnings.map(([label, warning]) => (
                  <span className="notice-line" key={`${label}:${warning}`}>
                    {label}：{warning}
                  </span>
                ))}
              </div>
            ) : null}

            {settings === null ? (
              <p className="hint-pane">
                {snapshot.settingsBlockedReason ?? copy.settingsBlockedFallback}
              </p>
            ) : (
              <SettingsForm
                capabilities={effectiveCapabilities ?? snapshot.capabilities}
                value={settings}
                errors={errors}
                onChange={setSettings}
                skins={resources.skins}
                onImportSkin={resources.importSkin}
                onDownloadSkin={resources.downloadSkinByName}
                skinDownloading={resources.skinDownloading}
                skinError={resources.skinError}
                cameraBusy={resources.cameraBusy}
                cameraError={resources.cameraError}
                onCameraAction={resources.cameraAction}
                mode="edit"
                storageDisplay={
                  snapshot.internalStorage.valueMiB === null
                    ? null
                    : String(snapshot.internalStorage.valueMiB)
                }
              />
            )}
          </div>
        ) : null}
      </div>

      <footer className="footer">
        <p className="footer-note">{blockedReason ?? copy.editorFooterNote}</p>
        <Button onClick={onCancel}>{copy.cancel}</Button>
        <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? copy.saving : copy.save}
        </Button>
      </footer>
      {saveError !== null ? (
        <div className="error-block" role="alert">
          <span className="error-text">{saveError}</span>
          <Button onClick={() => setSaveError(null)}>{copy.ok}</Button>
        </div>
      ) : null}
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
    -webkit-app-region: drag;
  }

  .traffic-spacer {
    flex: none;
    width: 60px;
    -webkit-app-region: no-drag;
  }

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

  .hint-pane {
    margin: 24px 16px;
    font-size: 12px;
    line-height: 1.8;
    color: var(--board-ink-dim);
  }

  .settings-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }

  .name-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: none;
    padding: 12px 16px 0;
  }

  .name-label {
    font-size: 12px;
    color: var(--board-ink-dim);
  }

  .identity-line {
    margin: 0;
    font-size: 12px;
    color: var(--board-ink-dim);
  }

  .identity-line.identity-line-small {
    font-size: 11px;
  }

  .notice-box {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 10px 16px 0;
    padding: 8px 10px;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: var(--board-bg-raised);
  }

  .notice-line {
    font-size: 11px;
    line-height: 1.6;
    color: var(--board-ink);
  }

  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 12px 16px;
    border-top: 1px solid var(--board-hairline);
  }

  .footer-note {
    flex: 1;
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--board-ink-dim);
  }

  .error-block {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 12px;
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

  .config-mismatch {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    padding: 4px 0;
    > span {
      flex: 1;
      min-width: 180px;
      overflow-wrap: anywhere;
    }
    > button {
      flex: none;
      height: 28px;
      padding: 0 10px;
      font-size: 11px;
    }
  }
  .cutout-reset {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--board-ink-dim);
  }
`

export default DeviceEditor
