import { format } from '@shared/i18n'
import { RECORDING_COPY, type RecordingCopy } from '@shared/i18n/recording'
import { getLocaleState } from '../locale/store'
export const recordingMsg = (
  key: keyof RecordingCopy,
  params?: Record<string, string | number>
): string => format(RECORDING_COPY[getLocaleState()][key], params)
