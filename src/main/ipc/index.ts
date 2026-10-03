import { registerDialogIpc } from '../dialog'
import { registerDevicesIpc } from '../devices'
import { registerWizardIpc } from '../window/wizard'
import { registerThemeIpc } from '../theme'

export function registerIpcHandlers(): void {
  registerDialogIpc()
  registerDevicesIpc()
  registerWizardIpc()
  registerThemeIpc()
}
