import { registerDialogIpc } from '../dialog'
import { registerDevicesIpc } from '../devices'

export function registerIpcHandlers(): void {
  registerDialogIpc()
  registerDevicesIpc()
}
