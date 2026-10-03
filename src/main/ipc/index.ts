import { registerDialogIpc } from '../dialog'
import { registerDevicesIpc } from '../devices'
import { registerSdkIpc } from '../emulator'
import { registerWizardIpc } from '../window/wizard'
import { registerThemeIpc } from '../theme'

export function registerIpcHandlers(): void {
  registerDialogIpc()
  registerDevicesIpc()
  registerSdkIpc()
  registerWizardIpc()
  registerThemeIpc()
}
