import { registerDialogIpc } from '../dialog'
import { registerDevicesIpc } from '../devices'
import { registerWizardIpc } from '../window/wizard'
import { registerWindowControlsIpc } from '../window/controls'

export function registerIpcHandlers(): void {
  registerDialogIpc()
  registerDevicesIpc()
  registerWizardIpc()
  registerWindowControlsIpc()
}
