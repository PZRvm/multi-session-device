import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, ScrollText } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { Device, RuntimeErrorMessage } from '@shared/types'
import { toApiResult } from './api'
import { useCopy } from './hooks/useCopy'
import { useLocaleStore } from './stores/localeStore'
import RecordingIndicator from './components/RecordingIndicator'
import { subscribeRecordings, useRecordingStore } from './stores/recordingStore'
import { RECORDING_COPY } from '@shared/i18n/recording'
import BoardHead from './components/BoardHead'
import Button from './components/Button'
import CanvasPlaceholder from './components/CanvasPlaceholder'
import DeviceCanvas from './components/DeviceCanvas'
import DeviceHealthNotice from './components/DeviceHealthNotice'
import DeviceListPane from './components/DeviceListPane'
import ExternalCanvas, { ExternalCanvasPlaceholder } from './components/ExternalCanvas'
import LogcatPanel from './components/LogcatPanel'
import ResizeHandle from './components/ResizeHandle'
import { clampListWidth, LIST_MAX_WIDTH } from './components/listWidth'
import {
  clampLogPaneWidth,
  LOG_PANE_MAX_WIDTH,
  LOG_PANE_MIN_WIDTH
} from './components/logPaneWidth'
import { useDeviceStore } from './stores/deviceStore'
import { useExternalStore } from './stores/externalStore'
import { splitByOriginView } from './components/originView'

/** 日志 dock 展开时画布至少保留的宽度（模拟器居中自适应的保底；不足则整栏退化） */
const LOG_CANVAS_MIN_WIDTH = 560

/**
 * 对账异常是否只落在另一来源桶（视图口径，用户 2026-10-12 复核续）：当前可见集
 * 无设备异常、且无库级异常/孤立组时，原生通知与报告窗都不打扰——另一桶设备的
 * 镜像不在当前根属预期（切回来就能用），不是值得打断用户的事。明细仍走
 * 「查看详情」与折叠区展开后的行内提示。
 */
const reconcileAnomalyHiddenFromView = (): boolean => {
  const state = useDeviceStore.getState()
  const { active } = splitByOriginView(state.devices, state.sourceBucket)
  const visibleAffected = active.some(
    (device) =>
      device.availability !== undefined &&
      device.availability.state !== 'valid' &&
      device.availability.state !== 'checking'
  )
  return (
    !visibleAffected &&
    (state.reconciliation.scanError ?? null) === null &&
    state.reconciliation.orphanCount === 0 &&
    state.storeHealth.state === 'ok'
  )
}

const App = (): React.JSX.Element => {
  const devices = useDeviceStore((state) => state.devices)
  const selectedId = useDeviceStore((state) => state.selectedId)
  const storeHealth = useDeviceStore((state) => state.storeHealth)
  const reconciliation = useDeviceStore((state) => state.reconciliation)
  const sourceBucket = useDeviceStore((state) => state.sourceBucket)
  const loadError = useDeviceStore((state) => state.loadError)
  const load = useDeviceStore((state) => state.load)
  const reconcile = useDeviceStore((state) => state.reconcile)
  const applySnapshot = useDeviceStore((state) => state.applySnapshot)
  const applyNetworkState = useDeviceStore((state) => state.applyNetworkState)
  const renameDevice = useDeviceStore((state) => state.rename)
  const removeDevice = useDeviceStore((state) => state.remove)
  const startDevice = useDeviceStore((state) => state.start)
  const stopDevice = useDeviceStore((state) => state.stop)
  const cancelStartDevice = useDeviceStore((state) => state.cancelStart)
  const setSelected = useDeviceStore((state) => state.setSelected)
  const locale = useLocaleStore((state) => state.locale)
  const copy = useCopy(MAIN_COPY)
  // 真机域（plan 2026-10-13-real-device-usb-and-apk-install）：推送直写 store；
  // 与 AVD 选择的互斥在组合层裁决（点一边清另一边）
  const externalDevices = useExternalStore((state) => state.devices)
  const selectedExternalId = useExternalStore((state) => state.selectedId)
  const applyExternalDevices = useExternalStore((state) => state.apply)
  const selectExternal = useExternalStore((state) => state.select)

  const [listWidth, setListWidth] = useState(280)
  const [rechecking, setRechecking] = useState(false)
  // 日志 dock 默认收起（不持久化开合状态——每次启动都从收起起步）；画布剩余
  // 不足 560 时点击入口直接开独立窗
  const [logDockOpen, setLogDockOpen] = useState(false)
  const [logPaneWidth, setLogPaneWidth] = useState(320)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const recordingCopy = useCopy(RECORDING_COPY)
  const recordingError = useRecordingStore((state) => state.errors[0] ?? null)
  const dismissRecordingError = useRecordingStore((state) => state.dismissError)
  useEffect(subscribeRecordings, [])
  // 失败队列逐条弹窗：关一条弹下一条，并发失败不互相覆盖
  useEffect(() => {
    if (!recordingError) return
    void toApiResult(
      window.api.dialog.show({
        title: recordingCopy.failed,
        message: recordingError,
        buttons: [recordingCopy.close]
      })
    ).finally(() => dismissRecordingError())
  }, [recordingError, dismissRecordingError, recordingCopy])

  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // useCallback：身份随 copy 稳定——下方两个订阅型 effect 可完整声明依赖，无需豁免
  const showAlert = useCallback(
    async (title: string, message: string): Promise<void> => {
      await toApiResult(window.api.dialog.show({ title, message, buttons: [copy.ok] }))
    },
    [copy]
  )

  useEffect(() => {
    void load()
    return window.api.devices.onChanged(applySnapshot)
  }, [load, applySnapshot])

  // 真机快照初拉 + 推送订阅（main 侧 diff、变化才推全量；store 内自清失效选中）
  useEffect(() => {
    void toApiResult(window.api.devices.listExternal()).then((result) => {
      if (result.ok) applyExternalDevices(result.data)
    })
    return window.api.devices.onExternalChanged(applyExternalDevices)
  }, [applyExternalDevices])

  // 选择互斥：点 AVD 行清真机选中（store 不交叉引用，组合层双向清）
  const handleSelectAvd = useCallback(
    (id: string): void => {
      selectExternal(null)
      setSelected(id)
    },
    [selectExternal, setSelected]
  )

  // 网络态变化推送（plan 2026-10-12）：1s 轮询 + 下发读回，值变化才推；直写 store 键。
  // 挂载时先拉一次快照恢复初值（review P3-1：仅变化才推，刷新后不拉则开关禁用到下次变化）。
  // 真机适配（S4）：id 分流——外部键（serial）写 externalStore，AVD 键写 deviceStore
  // （后者的 network 随快照 prune，外部键不能进）。初拉先确保真机快照在场再分区
  // （review 二轮 P3-A：getAll 先到时外部键会被在场守卫丢弃，靠 1s 轮询才补回）
  useEffect(() => {
    void (async () => {
      const external = await toApiResult(window.api.devices.listExternal())
      if (external.ok) applyExternalDevices(external.data)
      const result = await toApiResult(window.api.network.getAll())
      if (!result.ok) return
      for (const [id, entry] of Object.entries(result.data)) {
        if (useExternalStore.getState().devices.some((device) => device.id === id)) {
          useExternalStore.getState().applyNetworkState(id, entry)
        } else {
          applyNetworkState(id, entry)
        }
      }
    })()
    return window.api.network.onChanged((message) => {
      if (useExternalStore.getState().devices.some((device) => device.id === message.deviceId)) {
        useExternalStore.getState().applyNetworkState(message.deviceId, message.state)
      } else {
        applyNetworkState(message.deviceId, message.state)
      }
    })
  }, [applyNetworkState, applyExternalDevices])

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
    [copy, showAlert]
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
    // 视图口径静默（用户复核续）：异常全在另一来源桶——登记 seen 并代为 ack
    // （main 侧该签名不再待提示，重启也不复发），不弹原生通知
    if (reconcileAnomalyHiddenFromView()) {
      seenSignatures.current.add(signature)
      void toApiResult(window.api.devices.acknowledgeReconciliation(signature))
      return
    }
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
          // 补漏同样守视图口径：新异常只在另一桶时静默 ack，不开报告窗
          if (!reconcileAnomalyHiddenFromView()) {
            const opened = await toApiResult(window.api.report.openWindow())
            if (!opened.ok) await showAlert(copy.reconcileDetailTitle, opened.error)
          }
        }
      } finally {
        notificationInFlight.current = false
      }
    })()
  }, [reconciliation, copy, showReconciliationNotice, showAlert])

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
  // 出身过滤视图（plan 2026-10-12-device-list-origin-view-filter）：汇总条与板头
  // 计数按可见集口径（轴 2 + 用户「两边尽量隔离」批复）——不报看不见的设备
  const { active: visibleDevices } = splitByOriginView(devices, sourceBucket)
  // checking（创建中/暂缓判断）不算「文件异常」——与 main 侧报告口径一致（review P2-2）
  const isFileAffected = (device: Device): boolean =>
    device.availability !== undefined &&
    device.availability.state !== 'valid' &&
    device.availability.state !== 'checking'
  const affectedNames = visibleDevices.filter(isFileAffected).map((device) => device.name)
  const storeTrusted = storeHealth.state !== 'error'
  const metaWritable = storeHealth.state === 'ok'

  const handleRenameBlocked = (): void => {
    void showAlert(copy.renameBlockedTitle, copy.renameBlockedMessage)
  }

  // 跨来源桶设备尝试修改（重命名路径）的反馈（用户复核 5）：编辑/删除是禁用钮
  // 带 tooltip，重命名走键盘/双击无钮可禁——用 dialog 说明
  const handleCrossBucketBlocked = (): void => {
    void showAlert(copy.crossBucketModifyTitle, copy.crossBucketModifyMessage)
  }

  const handleRetryLoad = (): void => {
    void load()
  }

  // ---- 日志 dock（plan 2026-10-10-logcat-panel）----
  // 日志目标（S5 真机扩展）：真机选中且 connected → {id}（runId 在 main 会话代次，
  // renderer 不需要）；否则 AVD running（serial + runId 在场）。外部选中时 AVD 画布
  // 不可见，反之亦然——同一时刻至多一个目标
  const externalSelected =
    externalDevices.find((device) => device.id === selectedExternalId) ?? null
  const logTarget: { id: string; runId: string | null } | null =
    externalSelected !== null
      ? externalSelected.state === 'device'
        ? { id: externalSelected.id, runId: null }
        : null
      : selected && selected.status === 'running' && selected.serial && selected.runId
        ? { id: selected.id, runId: selected.runId }
        : null

  // 录制计时/生成反馈跟随当前选中（真机优先，同一时刻至多一个；?? 避免 || 对空串的语义分叉）
  const indicatorDevice = externalSelected ?? selected

  // 画布剩余不足保底 560 时 dock 不渲染（兜底派生——正常路径由 main 侧 minWidth
  // 锁定与拉宽保证 dock 展开时不被窗口缩窄挤掉）
  const logDockFits = viewportWidth - listWidth - 5 - logPaneWidth >= LOG_CANVAS_MIN_WIDTH
  const dockVisible = logDockOpen && logDockFits

  // dock 展开所需的主窗最小宽（列表 + 分隔条 + 日志栏 + 画布保底）
  const dockNeedWidth = listWidth + 5 + logPaneWidth + LOG_CANVAS_MIN_WIDTH

  // dock 跟随设备生命周期：无可用目标（停止/删除/选中切走/真机失联）时自动收起。
  // 否则 dock 空态挂死——入口按钮随设备消失、弹出按钮无设备直接 return，
  // dock 关不掉且 minWidth 锁残留（用户反馈「打开过 logcat 后窗口缩不小」）。
  // 渲染期对齐（React「adjust state during render」模式）：状态重置不进 effect，
  // 无 set-state-in-effect 的级联提交。logTarget 是派生对象（引用每帧新建），
  // 生命周期跟随用原始值 key 比较，不比引用
  const logcatKey = logTarget ? `${logTarget.id}:${logTarget.runId ?? ''}` : null
  const [prevLogcatKey, setPrevLogcatKey] = useState(logcatKey)
  if (logcatKey !== prevLogcatKey) {
    setPrevLogcatKey(logcatKey)
    if (!logcatKey) setLogDockOpen(false)
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
        window.api.logcat.openWindow(logTarget?.id)
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
    if (!logTarget) return
    // 失败弹原生 dialog（15s 超时/did-fail-load/renderer 崩溃带 detail）——不再静默
    const ok = await requestWindow('logcat-popout', copy.openLogcatWindowFailed, () =>
      window.api.logcat.openWindow(logTarget.id)
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

  const isWindows = window.api.platform === 'win32'
  const boardHead = (
    <BoardHead
      count={visibleDevices.length}
      compact={listWidth <= 320}
      onOpenSettings={() => void openSettings()}
    />
  )
  const logToggle = logTarget ? (
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
  ) : null
  return (
    <Wrapper lang={locale} data-windows={isWindows}>
      {isWindows ? (
        <header className="windows-header">
          <div className="header-content">
            <div className="windows-board-head" style={{ width: listWidth }}>
              {boardHead}
            </div>
            <div className="header-actions">{logToggle}</div>
          </div>
        </header>
      ) : null}
      <div className="workspace">
        <div className="list-pane" style={{ width: listWidth }}>
          {!isWindows ? boardHead : null}
          <DeviceHealthNotice
            summary={reconciliation}
            storeHealth={storeHealth}
            unavailableCount={affectedNames.length}
            affectedNames={affectedNames}
            rechecking={rechecking}
            onRecheck={handleRecheck}
            onViewDetail={handleViewDetail}
          />
          <DeviceListPane
            devices={devices}
            selectedId={externalSelected !== null ? null : selectedId}
            storeTrusted={storeTrusted}
            metaWritable={metaWritable}
            storeState={storeHealth.state}
            sourceBucket={sourceBucket}
            loadError={loadError}
            externalDevices={externalDevices}
            selectedExternalId={selectedExternalId}
            onSelectExternal={selectExternal}
            onRetryLoad={handleRetryLoad}
            onSelect={handleSelectAvd}
            onStart={handleStart}
            onStop={handleStop}
            onCancelStart={handleCancelStart}
            onCopySerial={handleCopySerial}
            onDelete={handleDelete}
            onRename={handleRename}
            onEdit={handleEdit}
            onRenameBlocked={handleRenameBlocked}
            onCrossBucketBlocked={handleCrossBucketBlocked}
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
          <div className="canvas-content">
            {externalSelected !== null ? (
              externalSelected.state === 'device' ? (
                <ExternalCanvas key={externalSelected.id} device={externalSelected} />
              ) : (
                <ExternalCanvasPlaceholder device={externalSelected} />
              )
            ) : selected && selected.status === 'running' ? (
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
          </div>
          <div className="canvas-tools">
            {indicatorDevice ? <RecordingIndicator deviceId={indicatorDevice.id} /> : null}
            {!isWindows ? logToggle : null}
          </div>
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
                key={logcatKey ?? 'none:'}
                deviceId={logTarget?.id ?? null}
                runId={logTarget?.runId ?? null}
                onPopOut={() => void handlePopOutLogcat()}
              />
            </aside>
          </>
        ) : null}
      </div>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;

  .workspace {
    display: contents;
  }
  &[data-windows='true'] {
    flex-direction: column;
  }
  &[data-windows='true'] .workspace {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .windows-header {
    position: relative;
    flex: none;
    height: 40px;
    background: var(--board-bg);
    -webkit-app-region: drag;
  }
  .windows-header::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--board-hairline);
    pointer-events: none;
  }
  .header-content {
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: env(titlebar-area-x, 0px);
    width: env(titlebar-area-width, calc(100% - 138px));
  }
  .windows-board-head {
    flex: 0 1 auto;
    min-width: 0;
  }
  .header-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex: 1 0 40px;
    min-width: 40px;
    height: 100%;
    padding-right: 10px;
  }
  .header-actions button {
    -webkit-app-region: no-drag;
  }

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
    flex-direction: column;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--board-bg);
    position: relative;
  }

  .canvas-content {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    width: 100%;
    min-height: 0;
    min-width: 0;
    position: relative;
  }

  .canvas-tools {
    position: absolute;
    top: 10px;
    right: 10px;
    max-width: calc(100% - 20px);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* 计时与日志共享工具组，正常排列，避免互相覆盖。 */
  .log-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    flex: none;
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
