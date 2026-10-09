import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import styled from 'styled-components'
import type { Device, ReconcileReport, RuntimeErrorMessage } from '@shared/types'
import { toApiResult } from './api'
import BoardHead from './components/BoardHead'
import Button from './components/Button'
import CanvasPlaceholder from './components/CanvasPlaceholder'
import DeviceCanvas from './components/DeviceCanvas'
import DeviceHealthNotice from './components/DeviceHealthNotice'
import DeviceListPane from './components/DeviceListPane'
import ResizeHandle from './components/ResizeHandle'
import { useDeviceStore } from './stores/deviceStore'

const App = (): React.JSX.Element => {
  const devices = useDeviceStore((state) => state.devices)
  const selectedId = useDeviceStore((state) => state.selectedId)
  const storeHealth = useDeviceStore((state) => state.storeHealth)
  const reconciliation = useDeviceStore((state) => state.reconciliation)
  const load = useDeviceStore((state) => state.load)
  const reconcile = useDeviceStore((state) => state.reconcile)
  const applySnapshot = useDeviceStore((state) => state.applySnapshot)
  const renameDevice = useDeviceStore((state) => state.rename)
  const removeDevice = useDeviceStore((state) => state.remove)
  const startDevice = useDeviceStore((state) => state.start)
  const stopDevice = useDeviceStore((state) => state.stop)
  const cancelStartDevice = useDeviceStore((state) => state.cancelStart)
  const setSelected = useDeviceStore((state) => state.setSelected)

  const [listWidth, setListWidth] = useState(280)
  const [rechecking, setRechecking] = useState(false)

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

  /** 报告详情文本：库异常、设备健康、孤立组与保留策略（不提供自动清理） */
  const buildDetailText = useCallback(async (): Promise<string> => {
    const result = await toApiResult(window.api.devices.reconciliationReport())
    if (!result.ok || result.data === null) return '当前没有对账报告。'
    const report: ReconcileReport = result.data
    const lines: string[] = []
    if (report.checkedAt !== null)
      lines.push(`上次检查：${new Date(report.checkedAt).toLocaleString()}`)
    for (const issue of report.storeHealth.issues) {
      lines.push(`元数据：${issue.message}`)
    }
    if (report.storeHealth.state === 'error' && report.storeHealth.issues.length === 0) {
      lines.push('元数据：读取失败（未知原因）')
    }
    for (const entry of report.deviceIssues) {
      for (const issue of entry.availability.issues) {
        lines.push(
          `「${entry.name}」${issue.component === 'image' ? '镜像' : 'AVD'}：${issue.message}`
        )
      }
    }
    for (const orphan of report.orphanEntries) {
      lines.push(`孤立文件组 ${orphan.id}：${orphan.detail}（保留原文件，不自动清理）`)
    }
    if (report.unrecognizedCount > 0) {
      lines.push(`另有 ${report.unrecognizedCount} 个非 UUID 命名的 .ini/.avd 形态文件未处理`)
    }
    if (report.scanError !== null) lines.push(`扫描问题：${report.scanError}`)
    return lines.length > 0 ? lines.join('\n') : '当前没有异常记录。'
  }, [])

  // 对账异常汇总：pendingNotification 变化时弹一次原生 dialog，成功展示后确认；
  // seen 只在成功展示后登记（review P3——失败/中途取消不压制后续重试），异常清零时
  // 复位 seen：同内容异常复发时重新提示（与 main 侧 acknowledged 复位对称）
  const seenSignatures = useRef(new Set<string>())
  useEffect(() => {
    if (reconciliation.signature === null) {
      seenSignatures.current.clear()
      return
    }
    const { signature, pendingNotification } = reconciliation
    if (!pendingNotification) return
    if (seenSignatures.current.has(signature)) return
    void (async () => {
      const detail = await buildDetailText()
      // 拉详情后再核对一次（review P3——首个 await 前的核对与闭包同 tick 恒等无效）：
      // 已被新检查替换的异常不再展示，迟到确认也不消费新签名
      const current = useDeviceStore.getState().reconciliation
      if (current.signature !== signature || !current.pendingNotification) return
      const shown = await toApiResult(
        window.api.dialog.show({
          title: '设备异常汇总',
          message: '设备文件或元数据存在异常，左侧列表上方已常驻汇总。',
          detail,
          buttons: ['知道了']
        })
      )
      if (!shown.ok) return // 展示失败不登记 seen，待下次推送重试
      seenSignatures.current.add(signature)
      await toApiResult(window.api.devices.acknowledgeReconciliation(signature))
    })()
  }, [reconciliation, buildDetailText])

  // main 共用加载结果；同上下文连点也只保留一个提示，直到提示关闭才允许重试。
  const pendingWindowOpens = useRef(new Set<string>())
  const requestWindow = async (
    key: string,
    title: string,
    request: () => Promise<void>
  ): Promise<void> => {
    if (pendingWindowOpens.current.has(key)) return
    pendingWindowOpens.current.add(key)
    try {
      const result = await toApiResult(request())
      if (!result.ok) await showAlert(title, result.error)
    } finally {
      pendingWindowOpens.current.delete(key)
    }
  }

  // 创建结果经 devices:changed 快照回流。
  const openWizard = (): Promise<void> =>
    requestWindow('create', '打开向导失败', () => window.api.wizard.open())

  const openSettings = (): Promise<void> =>
    requestWindow('settings', '打开设置窗口失败', () => window.api.settings.open())

  const handleRecheck = async (): Promise<void> => {
    setRechecking(true)
    const result = await reconcile()
    setRechecking(false)
    if (!result.ok) await showAlert('重新检查失败', result.error)
  }

  const handleViewDetail = async (): Promise<void> => {
    const detail = await buildDetailText()
    await toApiResult(
      window.api.dialog.show({ title: '设备对账详情', message: detail, buttons: ['知道了'] })
    )
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

  // 打开配置编辑窗（plan 2026-10-08）：上下文在 main 侧固定；已有其他上下文
  // 向导窗打开时 main 会聚焦旧窗并报错——这里把原因反馈给用户
  const handleEdit = (id: string): Promise<void> =>
    requestWindow(`edit:${id}`, '打开编辑窗口失败', () => window.api.wizard.openEditor(id))

  const selected = devices.find((device) => device.id === selectedId) ?? null
  // checking（创建中/暂缓判断）不算「文件异常」——与 main 侧报告口径一致（review P2-2）
  const affectedNames = devices
    .filter(
      (device) =>
        device.availability !== undefined &&
        device.availability.state !== 'valid' &&
        device.availability.state !== 'checking'
    )
    .map((device) => device.name)
  const storeTrusted = storeHealth.state !== 'error'
  const metaWritable = storeHealth.state === 'ok'
  const loadError = useDeviceStore((state) => state.loadError)

  const handleRenameBlocked = (): void => {
    void showAlert(
      '暂不能重命名',
      '设备元数据写入已冻结（设备数据异常），暂不能重命名；详情见左侧列表上方汇总'
    )
  }

  const handleRetryLoad = (): void => {
    void load()
  }

  return (
    <Wrapper>
      <div className="list-pane" style={{ width: listWidth }}>
        <BoardHead count={devices.length} onOpenSettings={() => void openSettings()} />
        <DeviceHealthNotice
          summary={reconciliation}
          storeHealth={storeHealth}
          affectedNames={affectedNames}
          rechecking={rechecking}
          onRecheck={handleRecheck}
          onViewDetail={handleViewDetail}
        />
        <DeviceListPane
          devices={devices}
          selectedId={selectedId}
          storeTrusted={storeTrusted}
          metaWritable={metaWritable}
          storeState={storeHealth.state}
          loadError={loadError}
          onRetryLoad={handleRetryLoad}
          onSelect={setSelected}
          onStart={handleStart}
          onStop={handleStop}
          onCancelStart={handleCancelStart}
          onCopySerial={handleCopySerial}
          onDelete={handleDelete}
          onRename={handleRename}
          onEdit={handleEdit}
          onRenameBlocked={handleRenameBlocked}
        />
        <footer className="foot">
          <Button
            variant="primary"
            onClick={openWizard}
            disabled={!metaWritable}
            title={
              metaWritable ? undefined : '设备元数据写入已冻结，暂不能新建设备（详情见上方汇总）'
            }
          >
            <span className="new-label">
              <Plus size={14} />
              新建设备
            </span>
          </Button>
        </footer>
      </div>
      <ResizeHandle width={listWidth} onResize={setListWidth} />
      <main className="canvas-area">
        {selected && selected.status === 'running' ? (
          <DeviceCanvas
            key={`${selected.id}:${selected.runId}`}
            device={selected}
            onStop={() => handleStop(selected.id)}
          />
        ) : (
          <CanvasPlaceholder
            device={selected}
            onCreate={openWizard}
            onRecheck={handleRecheck}
            rechecking={rechecking}
            storeState={storeHealth.state}
            createDisabled={!metaWritable}
          />
        )}
      </main>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;

  .list-pane {
    display: flex;
    flex-direction: column;
    flex: none;
    min-width: 0;
  }

  .foot {
    flex: none;
    padding: 12px;
    border-top: 1px solid var(--board-hairline);

    & > button {
      width: 100%;
    }
  }

  .new-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .canvas-area {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--board-bg);
  }
`

export default App
