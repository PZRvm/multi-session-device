import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { CreateDeviceInput, Device } from '@shared/types'
import { toApiResult } from './api'
import CanvasPlaceholder from './components/CanvasPlaceholder'
import DeviceListPane from './components/DeviceListPane'
import DeviceWizard from './components/DeviceWizard'
import ResizeHandle from './components/ResizeHandle'
import { useDeviceStore } from './stores/deviceStore'

const App = (): React.JSX.Element => {
  const devices = useDeviceStore((state) => state.devices)
  const selectedId = useDeviceStore((state) => state.selectedId)
  const load = useDeviceStore((state) => state.load)
  const applyDevices = useDeviceStore((state) => state.applyDevices)
  const createDevice = useDeviceStore((state) => state.create)
  const renameDevice = useDeviceStore((state) => state.rename)
  const removeDevice = useDeviceStore((state) => state.remove)
  const setRunning = useDeviceStore((state) => state.setRunning)
  const setSelected = useDeviceStore((state) => state.setSelected)

  const [listWidth, setListWidth] = useState(280)
  const [wizardOpen, setWizardOpen] = useState(false)

  useEffect(() => {
    void load()
    return window.api.devices.onChanged(applyDevices)
  }, [load, applyDevices])

  const showAlert = async (title: string, message: string): Promise<void> => {
    await toApiResult(window.api.dialog.show({ title, message, buttons: ['知道了'] }))
  }

  const handleCreate = async (input: CreateDeviceInput): Promise<void> => {
    const result = await createDevice(input)
    if (result.ok) setWizardOpen(false)
    else await showAlert('创建失败', result.error)
  }

  const handleRename = async (id: string, name: string): Promise<void> => {
    const result = await renameDevice(id, name)
    if (!result.ok) await showAlert('重命名失败', result.error)
  }

  const handleDelete = async (device: Device): Promise<void> => {
    const result = await toApiResult(
      window.api.dialog.show({
        title: '删除设备',
        message: `删除「${device.name}」？`,
        detail:
          '此操作不可撤销：\n· AVD 目录将被永久删除\n· 设备内所有数据（登录态、应用、文件）一并消失',
        buttons: ['取消', '删除'],
        cancelId: 0
      })
    )
    if (!result.ok) return
    if (result.data.response !== 1) return
    const removed = await removeDevice(device.id)
    if (!removed.ok) await showAlert('删除失败', removed.error)
  }

  const handleToggleRunning = async (id: string, running: boolean): Promise<void> => {
    const result = await setRunning(id, running)
    if (!result.ok) await showAlert('切换状态失败', result.error)
  }

  const selected = devices.find((device) => device.id === selectedId) ?? null

  return (
    <Shell>
      <ListPane style={{ width: listWidth }}>
        <DeviceListPane
          devices={devices}
          selectedId={selectedId}
          onSelect={setSelected}
          onToggleRunning={handleToggleRunning}
          onDelete={handleDelete}
          onRename={handleRename}
          onCreate={() => setWizardOpen(true)}
        />
      </ListPane>
      <ResizeHandle width={listWidth} onResize={setListWidth} />
      <CanvasArea>
        {wizardOpen ? (
          <DeviceWizard onCancel={() => setWizardOpen(false)} onCreate={handleCreate} />
        ) : (
          <CanvasPlaceholder device={selected} onCreate={() => setWizardOpen(true)} />
        )}
      </CanvasArea>
    </Shell>
  )
}

const Shell = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
`

const ListPane = styled.div`
  flex: none;
  min-width: 0;
`

const CanvasArea = styled.main`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--board-bg);
`

export default App
