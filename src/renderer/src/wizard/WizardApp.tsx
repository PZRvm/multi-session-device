import type { CreateDeviceInput } from '@shared/types'
import { toApiResult } from '../api'
import DeviceWizard from '../components/DeviceWizard'

/**
 * 新建设备模态窗的页面根：独立 BrowserWindow（main/window/wizard.ts），
 * 复用 DeviceWizard（填满视口）。创建走既有 devices IPC——
 * 主窗列表经 devices:changed 广播刷新，本窗不订阅、创建/取消后即请求关窗。
 */
const WizardApp = (): React.JSX.Element => {
  const handleCreate = async (input: CreateDeviceInput): Promise<void> => {
    const result = await toApiResult(window.api.devices.create(input))
    if (!result.ok) {
      await toApiResult(
        window.api.dialog.show({ title: '创建失败', message: result.error, buttons: ['知道了'] })
      )
      return
    }
    await toApiResult(window.api.wizard.close())
  }

  const handleCancel = (): void => {
    void toApiResult(window.api.wizard.close())
  }

  return <DeviceWizard onCreate={handleCreate} onCancel={handleCancel} />
}

export default WizardApp
