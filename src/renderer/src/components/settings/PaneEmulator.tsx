import { useState } from 'react'
import type {
  SdkMigrationProgress,
  SdkSourceMode,
  SdkSourceSnapshot,
  SdkSourceSwitchEvaluation
} from '@shared/types'
import { format } from '@shared/i18n'
import { windowsSdkRootTooLong } from '@shared/windowsPath'
import SettingsParts, { type SettingsPaneProps } from './SettingsParts'
import { useSdkSource } from './useSdkSource'

const SDK_MODES: readonly SdkSourceMode[] = ['managed', 'shared-studio', 'custom']

const ACTIVE_PHASES: readonly SdkMigrationProgress['phase'][] = [
  'scan',
  'moving',
  'relink',
  'cleanup'
]

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 矩阵判定的 rejected 代码 → 三语词条（plan §8：UI 侧映射，main 侧同判拒绝） */
const rejectedText = (
  copy: SettingsPaneProps['copy'],
  code: Extract<SdkSourceSwitchEvaluation, { action: 'rejected' }>['code']
): string => {
  switch (code) {
    case 'no-change':
      return copy.switchNoChange
    case 'running-sessions':
      return copy.switchRunningSessions
    case 'journal-pending':
      return copy.switchJournalPending
    case 'busy':
      return copy.switchBusy
    case 'studio-not-found':
      return copy.studioMissing
    case 'studio-sdk-not-located':
      return copy.studioSdkMissing
    case 'target-junk':
      return copy.switchTargetJunk
    case 'custom-path-required':
      return copy.switchPathRequired
    case 'studio-path-use-shared':
      return copy.switchStudioPath
  }
}

/** 活动根的原始值（plan 2026-10-23-windows-settings-finish）：单选行的路径展示与
 *  杀软白名单卡片 / 长路径警示共用的选择逻辑；null = 该模式当前未定位到路径。 */
const activeRootOf = (mode: SdkSourceMode, snapshot: SdkSourceSnapshot | null): string | null => {
  if (snapshot === null) return null
  if (mode === 'managed') return snapshot.managedRoot
  if (mode === 'shared-studio') {
    return snapshot.sharedPath ?? snapshot.detection?.sdkCandidate ?? null
  }
  return snapshot.customPath
}

const PaneEmulator = ({ model, copy }: SettingsPaneProps): React.JSX.Element => {
  const sdk = useSdkSource()
  const { appOwnedDeviceCount } = sdk
  const [error, setError] = useState<string | null>(null)

  const snapshot = sdk.snapshot
  const detection = snapshot?.detection ?? null
  const progress = sdk.progress
  const progressActive = progress !== null && ACTIVE_PHASES.includes(progress.phase)
  // 锁切换三态：动作在途 / 迁移进行中 / journal 未收尾（崩溃恢复横幅接管）
  // 锁切换三态：动作在途 / 迁移进行中 / journal 未收尾（含损坏——半迁移状态禁切换）
  const locked =
    sdk.acting ||
    progressActive ||
    ((snapshot?.migration != null || snapshot?.journalCorrupt === true) && !progressActive)
  const currentMode: SdkSourceMode = snapshot?.source ?? 'managed'
  // win32 专属卡片与警示（mac 恒不渲染；窗口平台走 preload 单源 window.api.platform）
  const isWin32 = window.api.platform === 'win32'
  const activeRoot = activeRootOf(currentMode, snapshot)
  const rootTooLong = isWin32 && activeRoot !== null && windowsSdkRootTooLong(activeRoot)
  // 共享选项可用性只由 studioFound 驱动（plan §5）；检测中先行禁用
  const sharedDisabled = sdk.detecting || detection === null || !detection.studioFound

  const runAction = async (task: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await task()
    } catch (cause) {
      setError(
        `${copy.actionFailedPrefix}${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
  }

  const applySwitch = async (target: SdkSourceMode, customPath?: string): Promise<void> => {
    await runAction(async () => {
      const evaluation = await sdk.evaluate(target, customPath)
      if (evaluation.action === 'rejected') {
        setError(rejectedText(copy, evaluation.code))
        return
      }
      if (evaluation.action === 'direct') return
      // 评估确认一步到位原生弹窗（2026-10-22 用户指示：弃窗内底部卡片，避免两连确认）
      if (evaluation.action === 'needs-migration') {
        const ok = await confirmDialog({
          title: copy.migrateConfirmTitle,
          message: `${evaluation.fromRoot} → ${evaluation.toRoot}（${formatBytes(
            evaluation.bytes
          )}）`,
          detail:
            copy.migrateConfirmDetail +
            (evaluation.boundDevices > 0
              ? `${evaluation.boundDevices}${copy.boundDevicesSuffix}`
              : ''),
          confirm: copy.migrateStart
        })
        if (ok) await sdk.startMigration(target, customPath, false)
        return
      }
      // needs-choice：三按钮弹窗（替换迁移 / 直接使用 / 取消），①②方案说明并入 detail
      const result = await window.api.dialog.show({
        title: copy.choiceCardTitle,
        message: `${evaluation.targetRoot}（${formatBytes(evaluation.targetBytes)}）`,
        detail:
          `① ${copy.choiceReplaceDetail}：${evaluation.loserRoot}（${formatBytes(
            evaluation.loserBytes
          )}）` +
          (evaluation.loserBoundDevices > 0
            ? `${evaluation.loserBoundDevices}${copy.boundDevicesSuffix}`
            : '') +
          `\n② ${copy.choiceUseDetail}`,
        buttons: [copy.choiceReplace, copy.choiceUse, copy.cancelAction],
        cancelId: 2
      })
      if (result.response === 0) await sdk.startMigration(target, customPath, true)
      else if (result.response === 1) await sdk.adopt(target, customPath)
    })
  }

  const pickCustomRoot = async (target: SdkSourceMode): Promise<void> => {
    await runAction(async () => {
      const picked = await sdk.chooseCustomRoot()
      if (picked === null) return
      // 同路径重选的无操作仅限「已在自选模式」；从托管/共享切回自选时，即便选的是
      // 上次记住的路径也要走判定矩阵（否则静默吞掉切换：不弹窗也不换——2026-10-22 实测）
      if (target === 'custom' && currentMode === 'custom' && picked === snapshot?.customPath) return
      await applySwitch(target, picked)
    })
  }

  const onRadioChange = (target: SdkSourceMode): void => {
    if (locked || target === currentMode) return
    // 禁用态双保险：jsdom/合成事件可穿透 disabled，判定守卫在 main 侧还有第三道
    if (target === 'shared-studio' && sharedDisabled) return
    if (target === 'custom') {
      void pickCustomRoot(target)
      return
    }
    void applySwitch(target)
  }

  const confirmDialog = async (input: {
    title: string
    message: string
    detail: string
    confirm: string
  }): Promise<boolean> => {
    const result = await window.api.dialog.show({
      title: input.title,
      message: input.message,
      detail: input.detail,
      buttons: [input.confirm, copy.cancelAction],
      cancelId: 1
    })
    return result.response === 0
  }

  const clearRetained = async (root: string, bytes: number): Promise<void> => {
    // 级联计数（用户 2026-10-12 批复）：清除保留 SDK 连带删除全部项目自有设备
    const appOwned = await appOwnedDeviceCount()
    const ok = await confirmDialog({
      title: copy.clearConfirmTitle,
      message: `${root}（${formatBytes(bytes)}）`,
      detail:
        copy.clearConfirmDetail +
        (appOwned > 0 ? format(copy.clearConfirmDeviceCascade, { count: appOwned }) : ''),
      confirm: copy.clearConfirmButton
    })
    if (!ok) return
    await runAction(() => sdk.clearRetained(root))
  }

  const resumeMigration = async (): Promise<void> => {
    // journal 在场时 main 侧按 journal 续跑（target 参数被忽略），占位传 managed
    await runAction(() => sdk.startMigration('managed', undefined, false))
  }

  return (
    <SettingsParts title={copy.emulator} lead={copy.emulatorLead}>
      <fieldset>
        <legend>{copy.sdkSource}</legend>
        {SDK_MODES.map((mode) => {
          const disabled = locked || (mode === 'shared-studio' && sharedDisabled)
          const selected = currentMode === mode
          // 原「SDK 目录」板块并入（2026-10-12 用户指示删除重复板块）：选中态在
          // 选项行内展示路径与入口——托管显路径；共享显路径 + 重新检测；自选显路径 + 更换路径
          const selectedRoot = selected ? activeRootOf(mode, snapshot) : null
          // 选中行路径 = 活动根原始值；未定位到路径时退各模式的占位文案
          const activePath =
            selectedRoot ??
            (selected
              ? mode === 'managed'
                ? copy.managedDirectory
                : mode === 'shared-studio'
                  ? copy.notDetected
                  : copy.pathNotChosen
              : null)
          return (
            <div className="sdk-option" key={mode}>
              <input
                type="radio"
                name="sdk-source"
                value={mode}
                checked={selected}
                disabled={disabled}
                onChange={() => {
                  onRadioChange(mode)
                }}
                aria-label={copy[mode]}
              />
              <span>
                <span className="label">{copy[mode]}</span>
                <span className="description">
                  {mode === 'shared-studio' && sharedDisabled
                    ? sdk.detecting
                      ? copy.detectingStudio
                      : copy.studioMissing
                    : copy[`${mode}Hint` as const]}
                </span>
                {activePath !== null ? (
                  <span className="path-line">
                    <span className="path">{activePath}</span>
                    {mode === 'shared-studio' ? (
                      <button
                        className="inline-action"
                        type="button"
                        disabled={locked || sdk.detecting}
                        onClick={() => {
                          void sdk.runDetection()
                        }}
                      >
                        {copy.detect}
                      </button>
                    ) : null}
                    {mode === 'custom' ? (
                      <button
                        className="inline-action"
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          void pickCustomRoot('custom')
                        }}
                      >
                        {copy.switchChangePath}
                      </button>
                    ) : null}
                  </span>
                ) : null}
                {mode === 'custom' && selected && snapshot?.customPath == null ? (
                  <span className="description">{copy.defaultPathHint}</span>
                ) : null}
                {mode === 'shared-studio' &&
                selected &&
                detection !== null &&
                detection.sdkCandidate === null &&
                snapshot?.sharedPath == null ? (
                  <span className="description">{copy.studioSdkMissing}</span>
                ) : null}
              </span>
            </div>
          )
        })}
      </fieldset>
      <p className="hint block-divider">{copy.avdHint}</p>

      {isWin32 && snapshot !== null ? (
        <div className="action-card defender-card">
          <p className="card-title">{copy.defenderTitle}</p>
          <p className="card-line">{copy.defenderHint}</p>
          <p className="card-line defender-pair">
            <span>{copy.defenderSdkRoot}</span>
            <span className="path">{activeRoot ?? copy.notDetected}</span>
          </p>
          <p className="card-line defender-pair">
            <span>{copy.defenderAvdHome}</span>
            <span className="path">{snapshot.avdHome}</span>
          </p>
          <div className="card-actions">
            <button
              type="button"
              onClick={() => {
                void window.api.dialog.openWindowsDefender()
              }}
            >
              {copy.defenderOpen}
            </button>
          </div>
          <p className="card-line">{copy.defenderThirdParty}</p>
        </div>
      ) : null}

      {rootTooLong ? (
        <div className="action-card warn">
          <p className="card-title">{copy.pathTooLongTitle}</p>
          <p className="card-line">
            {format(copy.pathTooLongHint, { length: activeRoot?.length ?? 0 })}
          </p>
        </div>
      ) : null}

      {error !== null ? <p className="error-line">{error}</p> : null}

      {snapshot?.migration != null && !progressActive ? (
        <div className="action-card warn" role="alert">
          <p className="card-title">{copy.resumeTitle}</p>
          <p className="card-line">
            <span className="path">{snapshot.migration.fromRoot}</span> →{' '}
            <span className="path">{snapshot.migration.toRoot}</span>
          </p>
          <p className="card-line">
            {copy.resumeHintEntries}：{snapshot.migration.doneEntries}/
            {snapshot.migration.totalEntries}（{formatBytes(snapshot.migration.movedBytes)}/
            {formatBytes(snapshot.migration.totalBytes)}）
          </p>
          <div className="card-actions">
            <button
              type="button"
              disabled={sdk.acting}
              onClick={() => {
                void resumeMigration()
              }}
            >
              {copy.resumeAction}
            </button>
            <button
              type="button"
              disabled={sdk.acting}
              onClick={() => {
                void runAction(() => sdk.cancelMigration())
              }}
            >
              {copy.rollbackAction}
            </button>
          </div>
        </div>
      ) : null}

      {snapshot?.journalCorrupt === true && !progressActive ? (
        <div className="action-card warn" role="alert">
          <p className="card-title">{copy.journalCorruptTitle}</p>
          <div className="card-actions">
            <button
              type="button"
              disabled={sdk.acting}
              onClick={() => {
                void runAction(() => sdk.cancelMigration())
              }}
            >
              {copy.rollbackAction}
            </button>
          </div>
        </div>
      ) : null}

      {progress !== null ? (
        <div className="action-card" aria-live="polite">
          <p className="card-title">
            {progress.phase === 'done' ? copy.migrateDone : copy.migrateProgressTitle}
          </p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="card-line">
            {progress.percent}% · {formatBytes(progress.movedBytes)}/
            {formatBytes(progress.totalBytes)}
            {progress.currentEntry !== null ? ` · ${progress.currentEntry}` : ''}
          </p>
          {progress.phase === 'failed' ? <p className="error-line">{copy.migrateFailed}</p> : null}
          {progress.phase === 'cancelled' ? (
            <p className="card-line">{copy.migrateCancelled}</p>
          ) : null}
          {progressActive ? (
            <div className="card-actions">
              <button
                type="button"
                disabled={sdk.acting}
                onClick={() => {
                  void runAction(() => sdk.cancelMigration())
                }}
              >
                {copy.migrateCancel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {snapshot?.source === 'shared-studio' && snapshot.retainedRoots.length > 0 ? (
        <div className="action-card">
          <p className="card-title">{copy.retainedTitle}</p>
          {snapshot.retainedRoots.map((root) => (
            <p className="card-line" key={root.root}>
              <span className="path">{root.root}</span>（{formatBytes(root.bytes)} ·{' '}
              {copy.retainedBound}：{root.boundDevices}）
              <button
                type="button"
                className="inline-action"
                disabled={sdk.acting}
                onClick={() => {
                  void clearRetained(root.root, root.bytes)
                }}
              >
                {copy.retainedClear}
              </button>
            </p>
          ))}
        </div>
      ) : null}

      <h2>{copy.resources}</h2>
      <div className="row">
        <div className="row-label">
          <label className="label" htmlFor="max-instances">
            {copy.maxInstances}
          </label>
          <p className="description">{copy.maxInstancesHint}</p>
        </div>
        <input
          id="max-instances"
          className="number"
          type="number"
          disabled
          value={model.resources.maxInstances}
        />
      </div>
      <div className="row">
        <div className="row-label">
          <label className="label" htmlFor="memory-threshold">
            {copy.memory}
          </label>
          <p className="description">{copy.memoryHint}</p>
        </div>
        <input
          id="memory-threshold"
          className="threshold"
          disabled
          value={model.resources.memoryThresholdLabel ?? ''}
          placeholder={copy.memoryUnset}
        />
      </div>
    </SettingsParts>
  )
}
export default PaneEmulator
