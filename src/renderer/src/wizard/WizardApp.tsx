import { useEffect, useState } from 'react'
import type { CreateDeviceInput, WizardContext } from '@shared/types'
import { toApiResult } from '../api'
import DeviceEditor from '../components/DeviceEditor'
import DeviceWizard from '../components/DeviceWizard'

/**
 * 独立向导窗（非模态）的页面根：窗口上下文在 main 侧创建时固定（create/edit），
 * 首帧取回后路由——创建走 DeviceWizard，编辑走 DeviceEditor。命令走各自 IPC，
 * 主窗列表经 devices:changed 广播刷新，本窗完成/取消后即请求关窗。
 */
const WizardApp = (): React.JSX.Element => {
  const [context, setContext] = useState<WizardContext | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await toApiResult(window.api.wizard.context())
      setContext(result.ok ? (result.data ?? { kind: 'create' }) : { kind: 'create' })
    })()
  }, [])

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

  // 上下文未知前不渲染（误闪创建页会丢编辑首帧）
  if (context === null) return <></>
  if (context.kind === 'edit') {
    return <DeviceEditor deviceId={context.deviceId} onCancel={handleCancel} />
  }
  return <DeviceWizard onCreate={handleCreate} onCancel={handleCancel} />
}

export default WizardApp
