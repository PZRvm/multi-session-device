import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import styled from 'styled-components'
import type { Device } from '@shared/types'
import { toApiResult } from './api'
import BoardHead from './components/BoardHead'
import Button from './components/Button'
import CanvasPlaceholder from './components/CanvasPlaceholder'
import DeviceListPane from './components/DeviceListPane'
import ResizeHandle from './components/ResizeHandle'
import { useDeviceStore } from './stores/deviceStore'

const App = (): React.JSX.Element => {
  const devices = useDeviceStore((state) => state.devices)
  const selectedId = useDeviceStore((state) => state.selectedId)
  const load = useDeviceStore((state) => state.load)
  const applyDevices = useDeviceStore((state) => state.applyDevices)
  const renameDevice = useDeviceStore((state) => state.rename)
  const removeDevice = useDeviceStore((state) => state.remove)
  const setRunning = useDeviceStore((state) => state.setRunning)
  const setSelected = useDeviceStore((state) => state.setSelected)

  const [listWidth, setListWidth] = useState(280)

  useEffect(() => {
    void load()
    return window.api.devices.onChanged(applyDevices)
  }, [load, applyDevices])

  const showAlert = async (title: string, message: string): Promise<void> => {
    await toApiResult(window.api.dialog.show({ title, message, buttons: ['知道了'] }))
  }

  // 新建设备走原生模态子窗（main/window/wizard.ts）；创建结果经 devices:changed 广播回流
  const openWizard = async (): Promise<void> => {
    const result = await toApiResult(window.api.wizard.open())
    if (!result.ok) await showAlert('打开向导失败', result.error)
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
        <BoardHead count={devices.length} />
        <DeviceListPane
          devices={devices}
          selectedId={selectedId}
          onSelect={setSelected}
          onToggleRunning={handleToggleRunning}
          onDelete={handleDelete}
          onRename={handleRename}
        />
        <Foot>
          <Button variant="primary" onClick={openWizard}>
            <NewLabel>
              <Plus size={14} />
              新建设备
            </NewLabel>
          </Button>
        </Foot>
      </ListPane>
      <ResizeHandle width={listWidth} onResize={setListWidth} />
      <CanvasArea>
        <CanvasPlaceholder device={selected} onCreate={openWizard} />
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
  display: flex;
  flex-direction: column;
  flex: none;
  min-width: 0;
`

const Foot = styled.footer`
  flex: none;
  padding: 12px;
  border-top: 1px solid var(--board-hairline);

  & > button {
    width: 100%;
  }
`

const NewLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
