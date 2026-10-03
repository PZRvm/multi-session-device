import { registerDialogIpc } from '../dialog'
import { registerDevicesIpc } from '../devices'
import { registerWizardIpc } from '../window/wizard'

export function registerIpcHandlers(): void {
  registerDialogIpc()
  registerDevicesIpc()
  registerWizardIpc()
}
