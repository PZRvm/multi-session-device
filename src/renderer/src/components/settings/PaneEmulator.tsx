import { useState } from 'react'
import type { SdkMigrationProgress, SdkSourceMode, SdkSourceSwitchEvaluation } from '@shared/types'
import { format } from '@shared/i18n'
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

interface MigrateCard {
  kind: 'migrate'
  target: SdkSourceMode
  customPath: string | undefined
  fromRoot: string
  toRoot: string
  bytes: number
  boundDevices: number
}

interface ChoiceCard {
  kind: 'choice'
  target: SdkSourceMode
  customPath: string | undefined
  targetRoot: string
  targetBytes: number
  loserRoot: string
  loserBytes: number
  loserBoundDevices: number
}

type PendingCard = MigrateCard | ChoiceCard

const PaneEmulator = ({ model, copy }: SettingsPaneProps): React.JSX.Element => {
  const sdk = useSdkSource()
  const { appOwnedDeviceCount } = sdk
  const [card, setCard] = useState<PendingCard | null>(null)
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
      setCard({
        kind: evaluation.action === 'needs-migration' ? 'migrate' : 'choice',
        target,
        customPath,
        ...(evaluation.action === 'needs-migration'
          ? {
              fromRoot: evaluation.fromRoot,
              toRoot: evaluation.toRoot,
              bytes: evaluation.bytes,
              boundDevices: evaluation.boundDevices
            }
          : {
              targetRoot: evaluation.targetRoot,
              targetBytes: evaluation.targetBytes,
              loserRoot: evaluation.loserRoot,
              loserBytes: evaluation.loserBytes,
              loserBoundDevices: evaluation.loserBoundDevices
            })
      } as PendingCard)
    })
  }

  const pickCustomRoot = async (target: SdkSourceMode): Promise<void> => {
    await runAction(async () => {
      const picked = await sdk.chooseCustomRoot()
      if (picked === null) return
      if (target === 'custom' && picked === snapshot?.customPath) return
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

  const startMigration = async (input: MigrateCard, replace: boolean): Promise<void> => {
    const ok = await confirmDialog({
      title: replace ? copy.replaceConfirmTitle : copy.migrateConfirmTitle,
      message: `${input.fromRoot} → ${input.toRoot}（${formatBytes(input.bytes)}）`,
      detail:
        copy.migrateConfirmDetail +
        (input.boundDevices > 0 ? `${input.boundDevices}${copy.boundDevicesSuffix}` : ''),
      confirm: copy.migrateStart
    })
    setCard(null)
    if (!ok) return
    await runAction(() => sdk.startMigration(input.target, input.customPath, replace))
  }

  const adoptTarget = async (input: ChoiceCard): Promise<void> => {
    const ok = await confirmDialog({
      title: copy.useConfirmTitle,
      message: `${input.targetRoot}（${formatBytes(input.targetBytes)}）`,
      detail:
        `${copy.choiceUseDetail}：${input.loserRoot}（${formatBytes(input.loserBytes)}）` +
        (input.loserBoundDevices > 0 ? `${input.loserBoundDevices}${copy.boundDevicesSuffix}` : ''),
      confirm: copy.choiceUse
    })
    setCard(null)
    if (!ok) return
    await runAction(() => sdk.adopt(input.target, input.customPath))
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
          const activePath =
            mode === 'managed'
              ? selected
                ? (snapshot?.managedRoot ?? copy.managedDirectory)
                : null
              : mode === 'shared-studio'
                ? selected
                  ? (snapshot?.sharedPath ?? detection?.sdkCandidate ?? copy.notDetected)
                  : null
                : selected
                  ? (snapshot?.customPath ?? copy.pathNotChosen)
                  : null
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

      {error !== null ? <p className="error-line">{error}</p> : null}

      {card?.kind === 'migrate' ? (
        <div className="action-card" role="group" aria-label={copy.migrateCardTitle}>
          <p className="card-title">{copy.migrateCardTitle}</p>
          <p className="card-line">
            {copy.migrateCardFrom}：<span className="path">{card.fromRoot}</span>
          </p>
          <p className="card-line">
            {copy.migrateCardTo}：<span className="path">{card.toRoot}</span>（
            {formatBytes(card.bytes)}）
          </p>
          {card.boundDevices > 0 ? (
            <p className="card-line">
              {copy.migrateCardBound}：{card.boundDevices}
              {copy.boundDevicesSuffix}
            </p>
          ) : null}
          <div className="card-actions">
            <button
              type="button"
              onClick={() => {
                setCard(null)
                setError(null)
              }}
            >
              {copy.cancelAction}
            </button>
            <button
              type="button"
              disabled={sdk.acting}
              onClick={() => {
                void startMigration(card, false)
              }}
            >
              {copy.migrateStart}
            </button>
          </div>
        </div>
      ) : null}

      {card?.kind === 'choice' ? (
        <div className="action-card" role="group" aria-label={copy.choiceCardTitle}>
          <p className="card-title">{copy.choiceCardTitle}</p>
          <p className="card-line">
            <span className="path">{card.targetRoot}</span>（{formatBytes(card.targetBytes)}）
          </p>
          <p className="card-line">① {copy.choiceReplaceDetail}</p>
          <p className="card-line">② {copy.choiceUseDetail}</p>
          {card.loserBoundDevices > 0 ? (
            <p className="card-line">
              {copy.migrateCardBound}：{card.loserBoundDevices}
              {copy.boundDevicesSuffix}
            </p>
          ) : null}
          <div className="card-actions">
            <button
              type="button"
              onClick={() => {
                setCard(null)
                setError(null)
              }}
            >
              {copy.cancelAction}
            </button>
            <button
              type="button"
              disabled={sdk.acting}
              onClick={() => {
                void startMigration(
                  {
                    kind: 'migrate',
                    target: card.target,
                    customPath: card.customPath,
                    fromRoot: card.loserRoot,
                    toRoot: card.targetRoot,
                    bytes: card.loserBytes,
                    boundDevices: card.loserBoundDevices
                  },
                  true
                )
              }}
            >
              {copy.choiceReplace}
            </button>
            <button
              type="button"
              disabled={sdk.acting}
              onClick={() => {
                void adoptTarget(card)
              }}
            >
              {copy.choiceUse}
            </button>
          </div>
        </div>
      ) : null}

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
