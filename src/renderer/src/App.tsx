import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, ScrollText } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { Device, RuntimeErrorMessage } from '@shared/types'
import { toApiResult } from './api'
import { useCopy } from './hooks/useCopy'
import { useLocaleStore } from './stores/localeStore'
import BoardHead from './components/BoardHead'
import Button from './components/Button'
import CanvasPlaceholder from './components/CanvasPlaceholder'
import DeviceCanvas from './components/DeviceCanvas'
import DeviceHealthNotice from './components/DeviceHealthNotice'
import DeviceListPane from './components/DeviceListPane'
import LogcatPanel from './components/LogcatPanel'
import ResizeHandle from './components/ResizeHandle'
import { clampListWidth, LIST_MAX_WIDTH } from './components/listWidth'
import {
  clampLogPaneWidth,
  LOG_PANE_MAX_WIDTH,
  LOG_PANE_MIN_WIDTH
} from './components/logPaneWidth'
import { useDeviceStore } from './stores/deviceStore'

/** 日志 dock 展开时画布至少保留的宽度（模拟器居中自适应的保底；不足则整栏退化） */
const LOG_CANVAS_MIN_WIDTH = 560

const App = (): React.JSX.Element => {
  const devices = useDeviceStore((state) => state.devices)
  const selectedId = useDeviceStore((state) => state.selectedId)
  const storeHealth = useDeviceStore((state) => state.storeHealth)
  const reconciliation = useDeviceStore((state) => state.reconciliation)
  const loadError = useDeviceStore((state) => state.loadError)
  const load = useDeviceStore((state) => state.load)
  const reconcile = useDeviceStore((state) => state.reconcile)
  const applySnapshot = useDeviceStore((state) => state.applySnapshot)
  const renameDevice = useDeviceStore((state) => state.rename)
  const removeDevice = useDeviceStore((state) => state.remove)
  const startDevice = useDeviceStore((state) => state.start)
  const stopDevice = useDeviceStore((state) => state.stop)
  const cancelStartDevice = useDeviceStore((state) => state.cancelStart)
  const setSelected = useDeviceStore((state) => state.setSelected)
  const locale = useLocaleStore((state) => state.locale)
  const copy = useCopy(MAIN_COPY)

  const [listWidth, setListWidth] = useState(280)
  const [rechecking, setRechecking] = useState(false)
  // 日志 dock 默认收起（不持久化开合状态——每次启动都从收起起步）；画布剩余
  // 不足 560 时点击入口直接开独立窗
  const [logDockOpen, setLogDockOpen] = useState(false)
  const [logPaneWidth, setLogPaneWidth] = useState(320)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const showAlert = async (title: string, message: string): Promise<void> => {
    await toApiResult(window.api.dialog.show({ title, message, buttons: [copy.ok] }))
  }

  useEffect(() => {
    void load()
    return window.api.devices.onChanged(applySnapshot)
  }, [load, applySnapshot])

  // 后台运行故障按 eventId 去重弹原生 dialog；行内 lastError 常驻。
  // copy 入依赖：语言切换后重建订阅，后续弹窗即新语言（已弹出的不追溯）
  const seenErrors = useRef(new Set<string>())
  useEffect(
    () =>
      window.api.devices.onRuntimeError((message: RuntimeErrorMessage) => {
        if (seenErrors.current.has(message.eventId)) return
        seenErrors.current.add(message.eventId)
        void showAlert(copy.runtimeErrorTitle, message.message)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showAlert 每渲染新建，语义上只依赖 copy
    [copy]
  )

  // 对账异常汇总：pendingNotification 变化时弹一次原生 dialog，成功展示后确认；
  // seen 只在成功展示后登记（review P3——失败/中途取消不压制后续重试），异常清零时
  // 复位 seen：同内容异常复发时重新提示（与 main 侧 acknowledged 复位对称）
  const seenSignatures = useRef(new Set<string>())
  // 在途通知互斥（弹三次回归的修法）：启动期 reconciliation 会推送多次，而 seen
  // 登记发生在弹窗关闭后——窗口开着时到达的推送全都会通过 seen 守卫重入。
  // 通知在屏期间拦下所有重入；关闭后由 seen/acknowledge 语义决定是否再弹。
  const notificationInFlight = useRef(false)
  /** 摘要式原生通知（plan 2026-10-12 设计轴 1）：完整明细走应用内面板，弹窗只报
   *  概况——按钮常在屏内，「查看详情」直接开面板。确认/查看都登记 seen 并 ack。 */
  const showReconciliationNotice = useCallback(
    async (signature: string): Promise<void> => {
      const shown = await toApiResult(
        window.api.dialog.show({
          title: copy.reconcileSummaryTitle,
          message: copy.reconcileSummaryMessage,
          buttons: [copy.reconcileSummaryView, copy.reconcileSummaryAck],
          cancelId: 1
        })
      )
      if (!shown.ok) return // 展示失败不登记 seen，待下次推送重试
      seenSignatures.current.add(signature)
      await toApiResult(window.api.devices.acknowledgeReconciliation(signature))
      if (shown.data.response === 0) void toApiResult(window.api.report.openWindow())
    },
    [copy]
  )
  useEffect(() => {
    if (reconciliation.signature === null) {
      seenSignatures.current.clear()
      return
    }
    const { signature, pendingNotification } = reconciliation
    if (!pendingNotification) return
    if (seenSignatures.current.has(signature)) return
    if (notificationInFlight.current) return
    notificationInFlight.current = true
    void (async () => {
      try {
        await showReconciliationNotice(signature)
        // 在途互斥的补漏（issue review P2）：弹窗开着时到达的新签名推送被上方
        // 拦截且无状态变化驱动重跑——释放前重查一次当前态，新异常不再漏弹
        const latest = useDeviceStore.getState().reconciliation
        if (
          latest.signature !== null &&
          latest.pendingNotification &&
          !seenSignatures.current.has(latest.signature)
        ) {
          seenSignatures.current.add(latest.signature)
          await toApiResult(window.api.devices.acknowledgeReconciliation(latest.signature))
          const opened = await toApiResult(window.api.report.openWindow())
          if (!opened.ok) await showAlert(copy.reconcileDetailTitle, opened.error)
        }
      } finally {
        notificationInFlight.current = false
      }
    })()
  }, [reconciliation, copy, showReconciliationNotice])

  // main 共用加载结果；同上下文连点也只保留一个提示，直到提示关闭才允许重试。
  // 返回是否成功（去重命中视为未成功——请求未由本次发起）
  const pendingWindowOpens = useRef(new Set<string>())
  const requestWindow = async (
    key: string,
    title: string,
    request: () => Promise<void>
  ): Promise<boolean> => {
    if (pendingWindowOpens.current.has(key)) return false
    pendingWindowOpens.current.add(key)
    try {
      const result = await toApiResult(request())
      if (!result.ok) {
        await showAlert(title, result.error)
        return false
      }
      return true
    } finally {
      pendingWindowOpens.current.delete(key)
    }
  }

  // 创建结果经 devices:changed 快照回流。
  const openWizard = (): Promise<void> =>
    requestWindow('create', copy.openWizardFailed, () => window.api.wizard.open()).then(
      () => undefined
    )

  const openSettings = (): Promise<void> =>
    requestWindow('settings', copy.openSettingsFailed, () => window.api.settings.open()).then(
      () => undefined
    )

  const handleRecheck = async (): Promise<void> => {
    setRechecking(true)
    const result = await reconcile()
    setRechecking(false)
    if (!result.ok) await showAlert(copy.recheckFailed, result.error)
  }

  // 汇总条「查看详情」：独立对账详情窗（子窗口方案；原长文本弹窗退役）
  const handleViewDetail = (): void => {
    void toApiResult(window.api.report.openWindow()).then((result) => {
      if (!result.ok) void showAlert(copy.reconcileDetailTitle, result.error)
    })
  }

  const handleRename = async (id: string, name: string): Promise<void> => {
    const result = await renameDevice(id, name)
    if (!result.ok) await showAlert(copy.renameFailed, result.error)
  }

  const handleDelete = async (device: Device): Promise<void> => {
    const willStopFirst = device.status === 'running'
    const result = await toApiResult(
      window.api.dialog.show({
        title: copy.deleteDeviceTitle,
        message: format(copy.deleteConfirm, { name: device.name }),
        detail: willStopFirst ? copy.deleteRunningDetail : copy.deleteDetail,
        buttons: [copy.cancel, copy.delete],
        cancelId: 0
      })
    )
    if (!result.ok) return
    if (result.data.response !== 1) return
    const removed = await removeDevice(device.id)
    if (!removed.ok) await showAlert(copy.deleteFailed, removed.error)
  }

  const handleStart = async (id: string): Promise<void> => {
    const result = await startDevice(id)
    if (!result.ok) await showAlert(copy.startFailed, result.error)
  }

  const handleStop = async (id: string): Promise<void> => {
    const result = await stopDevice(id)
    if (!result.ok) await showAlert(copy.stopFailed, result.error)
  }

  const handleCancelStart = async (id: string): Promise<void> => {
    const result = await cancelStartDevice(id)
    if (!result.ok) await showAlert(copy.cancelFailed, result.error)
  }

  const handleCopySerial = async (id: string): Promise<void> => {
    const result = await toApiResult(window.api.devices.copySerial(id))
    if (!result.ok) await showAlert(copy.copyFailed, result.error)
  }

  // 打开配置编辑窗（plan 2026-10-08）：上下文在 main 侧固定；已有其他上下文
  // 向导窗打开时 main 会聚焦旧窗并报错——这里把原因反馈给用户
  const handleEdit = (id: string): Promise<void> =>
    requestWindow(`edit:${id}`, copy.openEditorFailed, () => window.api.wizard.openEditor(id)).then(
      () => undefined
    )

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

  const handleRenameBlocked = (): void => {
    void showAlert(copy.renameBlockedTitle, copy.renameBlockedMessage)
  }

  const handleRetryLoad = (): void => {
    void load()
  }

  // ---- 日志 dock（plan 2026-10-10-logcat-panel）----

  const logcatDevice =
    selected && selected.status === 'running' && selected.serial && selected.runId ? selected : null

  // 画布剩余不足保底 560 时 dock 不渲染（兜底派生——正常路径由 main 侧 minWidth
  // 锁定与拉宽保证 dock 展开时不被窗口缩窄挤掉）
  const logDockFits = viewportWidth - listWidth - 5 - logPaneWidth >= LOG_CANVAS_MIN_WIDTH
  const dockVisible = logDockOpen && logDockFits

  // dock 展开所需的主窗最小宽（列表 + 分隔条 + 日志栏 + 画布保底）
  const dockNeedWidth = listWidth + 5 + logPaneWidth + LOG_CANVAS_MIN_WIDTH

  // dock 跟随设备生命周期：无 running 设备（停止/删除/选中切走）时自动收起。
  // 否则 dock 空态挂死——入口按钮随设备消失、弹出按钮无设备直接 return，
  // dock 关不掉且 minWidth 锁残留（用户反馈「打开过 logcat 后窗口缩不小」）。
  // 渲染期对齐（React「adjust state during render」模式）：状态重置不进 effect，
  // 无 set-state-in-effect 的级联提交
  const [prevLogcatDevice, setPrevLogcatDevice] = useState(logcatDevice)
  if (logcatDevice !== prevLogcatDevice) {
    setPrevLogcatDevice(logcatDevice)
    if (!logcatDevice) setLogDockOpen(false)
  }

  // 声明式同步：dock 可见 → 锁主窗 minWidth（拖宽变化跟随）；不可见（收起、
  // 弹出独立窗、外力兜底）→ 解锁——独立窗口态主窗宽度完全自由
  useEffect(() => {
    void toApiResult(
      window.api.logcat.setDockState(
        dockVisible ? { expanded: true, minWidth: dockNeedWidth } : { expanded: false }
      )
    )
  }, [dockVisible, dockNeedWidth])

  // 显式拉宽先于展开渲染（窄窗点入口/贴回：dock 出现的同一时刻窗口已够宽）
  const expandDock = async (): Promise<void> => {
    await toApiResult(window.api.logcat.setDockState({ expanded: true, minWidth: dockNeedWidth }))
    setLogDockOpen(true)
  }

  // 独立日志窗开着时点入口 = 聚焦该窗（单例）；否则开合 dock（窄窗由 main
  // 拉宽窗口让 dock 黏滞右侧，不再退化独立窗——独立窗只经面板内「弹出」产生）
  const handleToggleLogDock = async (): Promise<void> => {
    const windowOpen = await toApiResult(window.api.logcat.isWindowOpen())
    if (windowOpen.ok && windowOpen.data) {
      void requestWindow('logcat', copy.openLogcatWindowFailed, () =>
        window.api.logcat.openWindow(logcatDevice?.id)
      )
      return
    }
    if (dockVisible) {
      setLogDockOpen(false)
      return
    }
    await expandDock()
  }

  const handlePopOutLogcat = async (): Promise<void> => {
    if (!logcatDevice) return
    // 失败弹原生 dialog（15s 超时/did-fail-load/renderer 崩溃带 detail）——不再静默
    const ok = await requestWindow('logcat-popout', copy.openLogcatWindowFailed, () =>
      window.api.logcat.openWindow(logcatDevice.id)
    )
    if (ok) setLogDockOpen(false)
  }

  // 独立窗「贴回」：关窗由 main 侧完成，这里重新展开 dock（窄窗同样拉宽）。
  // 宽度需求经 ref 取最新值——空依赖订阅的闭包不捕获过期的 dockNeedWidth
  const dockNeedWidthRef = useRef(dockNeedWidth)
  useEffect(() => {
    dockNeedWidthRef.current = dockNeedWidth
  }, [dockNeedWidth])
  useEffect(
    () =>
      window.api.logcat.onDockBack(() => {
        void (async () => {
          await toApiResult(
            window.api.logcat.setDockState({ expanded: true, minWidth: dockNeedWidthRef.current })
          )
          setLogDockOpen(true)
        })()
      }),
    []
  )

  return (
    <Wrapper lang={locale}>
      <div className="list-pane" style={{ width: listWidth }}>
        <BoardHead
          count={devices.length}
          compact={listWidth <= 320}
          onOpenSettings={() => void openSettings()}
        />
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
            title={metaWritable ? undefined : copy.createDisabledTitleFooter}
          >
            <span className="new-label">
              <Plus size={14} />
              {copy.createDevice}
            </span>
          </Button>
        </footer>
      </div>
      <ResizeHandle
        width={listWidth}
        onResize={setListWidth}
        maxWidth={
          dockVisible ? viewportWidth - logPaneWidth - 5 - LOG_CANVAS_MIN_WIDTH : LIST_MAX_WIDTH
        }
        clamp={(width) =>
          dockVisible
            ? clampListWidth(
                Math.min(width, viewportWidth - logPaneWidth - 5 - LOG_CANVAS_MIN_WIDTH)
              )
            : clampListWidth(width)
        }
      />
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
        {logcatDevice ? (
          <button
            type="button"
            className="log-toggle"
            aria-label={copy.logcatTitle}
            aria-pressed={dockVisible}
            title={copy.logcatTitle}
            onClick={handleToggleLogDock}
          >
            <ScrollText size={16} />
          </button>
        ) : null}
      </main>
      {dockVisible ? (
        <>
          <ResizeHandle
            edge="left"
            width={logPaneWidth}
            onResize={setLogPaneWidth}
            ariaLabel={copy.logcatResizeAria}
            minWidth={LOG_PANE_MIN_WIDTH}
            maxWidth={Math.min(
              LOG_PANE_MAX_WIDTH,
              viewportWidth - listWidth - 5 - LOG_CANVAS_MIN_WIDTH
            )}
            clamp={(width) =>
              clampLogPaneWidth(
                Math.min(width, viewportWidth - listWidth - 5 - LOG_CANVAS_MIN_WIDTH)
              )
            }
          />
          <aside className="log-pane" style={{ width: logPaneWidth }}>
            <LogcatPanel
              key={`${logcatDevice?.id ?? 'none'}:${logcatDevice?.runId ?? ''}`}
              deviceId={logcatDevice?.id ?? null}
              runId={logcatDevice?.runId ?? null}
              onPopOut={() => void handlePopOutLogcat()}
            />
          </aside>
        </>
      ) : null}
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
    position: relative;
  }

  /* 日志 dock 入口（画布右上角，与设置齿轮同侧约定）；仅运行中设备出现 */
  .log-toggle {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--board-hairline);
    border-radius: 8px;
    background: var(--board-bg-raised);
    color: var(--board-ink);
    cursor: pointer;
    transition: background-color 0.12s;

    &:hover {
      background: var(--board-hover-veil);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
  }

  .log-pane {
    flex: none;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
`

export default App
