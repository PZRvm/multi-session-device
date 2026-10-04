import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import styled from 'styled-components'
import type { Device, RuntimeErrorMessage } from '@shared/types'
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
  const applySnapshot = useDeviceStore((state) => state.applySnapshot)
  const renameDevice = useDeviceStore((state) => state.rename)
  const removeDevice = useDeviceStore((state) => state.remove)
  const startDevice = useDeviceStore((state) => state.start)
  const stopDevice = useDeviceStore((state) => state.stop)
  const cancelStartDevice = useDeviceStore((state) => state.cancelStart)
  const setSelected = useDeviceStore((state) => state.setSelected)

  const [listWidth, setListWidth] = useState(280)

  const showAlert = async (title: string, message: string): Promise<void> => {
    await toApiResult(window.api.dialog.show({ title, message, buttons: ['知道了'] }))
  }

  useEffect(() => {
    void load()
    return window.api.devices.onChanged(applySnapshot)
  }, [load, applySnapshot])

  // 后台运行故障按 eventId 去重弹原生 dialog；行内 lastError 常驻
  const seenErrors = useRef(new Set<string>())
  useEffect(
    () =>
      window.api.devices.onRuntimeError((message: RuntimeErrorMessage) => {
        if (seenErrors.current.has(message.eventId)) return
        seenErrors.current.add(message.eventId)
        void showAlert('模拟器运行异常', message.message)
      }),
    []
  )

  // 新建设备走原生模态子窗（main/window/wizard.ts）；创建结果经 devices:changed 快照回流
  const openWizard = async (): Promise<void> => {
    const result = await toApiResult(window.api.wizard.open())
    if (!result.ok) await showAlert('打开向导失败', result.error)
  }

  const handleRename = async (id: string, name: string): Promise<void> => {
    const result = await renameDevice(id, name)
    if (!result.ok) await showAlert('重命名失败', result.error)
  }

  const handleDelete = async (device: Device): Promise<void> => {
    const willStopFirst = device.status === 'running'
    const result = await toApiResult(
      window.api.dialog.show({
        title: '删除设备',
        message: `删除「${device.name}」？`,
        detail: willStopFirst
          ? '设备正在运行：将先停止并等待退出，再删除 AVD。\n此操作不可撤销：AVD 目录与设备内所有数据将永久删除。'
          : '此操作不可撤销：\n· AVD 目录将被永久删除\n· 设备内所有数据（登录态、应用、文件）一并消失',
        buttons: ['取消', '删除'],
        cancelId: 0
      })
    )
    if (!result.ok) return
    if (result.data.response !== 1) return
    const removed = await removeDevice(device.id)
    if (!removed.ok) await showAlert('删除失败', removed.error)
  }

  const handleStart = async (id: string): Promise<void> => {
    const result = await startDevice(id)
    if (!result.ok) await showAlert('启动失败', result.error)
  }

  const handleStop = async (id: string): Promise<void> => {
    const result = await stopDevice(id)
    if (!result.ok) await showAlert('停止失败', result.error)
  }

  const handleCancelStart = async (id: string): Promise<void> => {
    const result = await cancelStartDevice(id)
    if (!result.ok) await showAlert('取消失败', result.error)
  }

  const handleCopySerial = async (id: string): Promise<void> => {
    const result = await toApiResult(window.api.devices.copySerial(id))
    if (!result.ok) await showAlert('复制失败', result.error)
  }

  const selected = devices.find((device) => device.id === selectedId) ?? null

  return (
    <Shell>
      <ListPane style={{ width: listWidth }}>
        <BoardHead count={devices.length} panelWidth={listWidth} />
        <DeviceListPane
          devices={devices}
          selectedId={selectedId}
          onSelect={setSelected}
          onStart={handleStart}
          onStop={handleStop}
          onCancelStart={handleCancelStart}
          onCopySerial={handleCopySerial}
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
