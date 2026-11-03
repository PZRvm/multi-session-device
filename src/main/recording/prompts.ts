import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { format } from '@shared/i18n'
import { appIcon } from '../app-icon'
import type { RecordingDeps } from './manager'
import { RecordingPreferences } from './preferences'
import { recordingMsg as msg } from './copy'

export const createRecordingConfirm =
  (
    preferences: RecordingPreferences,
    parent: () => BrowserWindow | null
  ): RecordingDeps['confirm'] =>
  async (kind, values, context) => {
    const epoch = preferences.epoch
    if (context && (await preferences.has(context.key))) return context.valid()
    if (context && !context.valid()) return false
    const keys =
      kind === 'silent'
        ? (['unavailableTitle', 'unavailable', 'silentContinue'] as const)
        : kind === 'resize'
          ? (['downscaleTitle', 'downscale', 'continue'] as const)
          : kind === 'capture-size'
            ? (['downscaleTitle', 'captureSize', 'continueRecording'] as const)
            : (['discardTitle', 'discardMessage', 'discard'] as const)
    const options: MessageBoxOptions = {
      type: 'warning',
      title: msg(keys[0]),
      message: format(msg(keys[1]), values),
      detail:
        kind === 'silent' ? `${msg('unavailableDetail')}\n${values?.reason ?? ''}` : undefined,
      buttons: [msg(keys[2]), msg('cancel')],
      cancelId: 1,
      defaultId: 1,
      icon: appIcon,
      ...(context
        ? {
            checkboxLabel: msg(kind === 'silent' ? 'rememberSilent' : 'rememberSize'),
            checkboxChecked: false
          }
        : {})
    }
    const owner = parent()
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 0 || (context && !context.valid())) return false
    if (context && result.checkboxChecked) {
      try {
        await preferences.remember(context.key, epoch)
      } catch {
        const warning: MessageBoxOptions = {
          type: 'warning',
          message: msg('rememberFailed'),
          buttons: [msg('close')],
          icon: appIcon
        }
        const current = parent()
        if (current) await dialog.showMessageBox(current, warning)
        else await dialog.showMessageBox(warning)
      }
    }
    return !context || context.valid()
  }
