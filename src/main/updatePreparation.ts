import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { UPDATE_COPY } from '@shared/i18n'
import { getLocaleState } from './locale/store'

let preparing = false
let installing = false
let pending = 0

export const isUpdatePreparing = (): boolean => preparing
export const isUpdateInstalling = (): boolean => installing
export const setUpdateInstalling = (next: boolean): void => {
  installing = next
}
export const hasUpdateWork = (): boolean => pending > 0

export function beginUpdatePreparation(): void {
  if (preparing || pending) throw new Error(UPDATE_COPY[getLocaleState()].errors.busy)
  preparing = true
}

export function resumeUpdatePreparation(): void {
  preparing = false
}

export function handleUpdateMutation<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Result
): void {
  ipcMain.handle(channel, (event, ...args: Args) => {
    if (preparing) throw new Error(UPDATE_COPY[getLocaleState()].errors.busy)
    pending++
    try {
      const result = listener(event, ...args)
      if (result instanceof Promise) {
        return result.finally(() => {
          pending--
        })
      }
      pending--
      return result
    } catch (error) {
      pending--
      throw error
    }
  })
}
