import { useEffect, useState } from 'react'
import { PanelLeftClose } from 'lucide-react'
import styled from 'styled-components'
import type { DeviceRuntimeView, DeviceSnapshot, ExternalDevice } from '@shared/types'
import { MAIN_COPY } from '@shared/i18n'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'
import { useLocaleStore } from '../stores/localeStore'
import LogcatPanel from '../components/LogcatPanel'

/** 弹出时带来的目标设备（?device=<id>；窗口生命周期内不变，解析一次） */
const INITIAL_DEVICE_ID = new URLSearchParams(window.location.search).get('device')

/** 全窗广播快照 → 运行态窄视图（本窗只消费下拉/订阅所需字段） */
const runtimeViewsOf = (snapshot: DeviceSnapshot): DeviceRuntimeView[] =>
  snapshot.devices.map((device) => ({
    id: device.id,
    name: device.name,
    status: device.status,
    serial: device.serial,
    runId: device.runId
  }))

/** 真机推送 → 运行视图（只有 device 态可订阅；runId 在 main 会话代次，本窗不需要） */
const externalViewsOf = (devices: ExternalDevice[]): DeviceRuntimeView[] =>
  devices
    .filter((device) => device.state === 'device')
    .map((device) => ({
      id: device.id,
      name: device.model ?? device.serial,
      status: 'running',
      serial: device.serial,
      origin: 'external' as const
    }))

/**
 * 独立日志窗：running 设备下拉 + 共用日志面板。关窗只是退订——会话跟设备走（plan）。
 * 双流订阅（2026-10-13 真机适配）：AVD 走 devices:changed 全窗广播，真机走
 * devices:external-changed 广播（都各自覆盖本流全量）；启动时 context() 一次取合并
 * 视图，按 origin 判别精确拆两桶（review P3-2——不再用 runId 启发式）。
 */
const LogcatApp = (): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const locale = useLocaleStore((state) => state.locale)
  const [avdViews, setAvdViews] = useState<DeviceRuntimeView[]>([])
  const [externalViews, setExternalViews] = useState<DeviceRuntimeView[]>([])
  const [pickedId, setPickedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const result = await toApiResult(window.api.logcat.context())
      if (alive && result.ok) {
        setAvdViews(result.data.filter((view) => view.origin !== 'external'))
        setExternalViews(result.data.filter((view) => view.origin === 'external'))
      }
    })()
    const unbind = window.api.devices.onChanged((snapshot: DeviceSnapshot) => {
      setAvdViews(runtimeViewsOf(snapshot))
    })
    const unbindExternal = window.api.devices.onExternalChanged((devices: ExternalDevice[]) => {
      setExternalViews(externalViewsOf(devices))
    })
    return () => {
      alive = false
      unbind()
      unbindExternal()
    }
  }, [])

  // 真机视图无 runId（main 会话代次不进 renderer）——可订阅判据只看 running + serial
  const running = [...avdViews, ...externalViews].filter(
    (device) => device.status === 'running' && device.serial
  )
  // 目标链：手选（仍 running）→ 弹出时带来的 ?device= → 首个 running；目标停止自动回退
  const effectiveId =
    pickedId !== null && running.some((device) => device.id === pickedId)
      ? pickedId
      : INITIAL_DEVICE_ID !== null && running.some((device) => device.id === INITIAL_DEVICE_ID)
        ? INITIAL_DEVICE_ID
        : (running[0]?.id ?? null)
  const selected = running.find((device) => device.id === effectiveId) ?? null

  const handleDockBack = (): void => {
    void toApiResult(window.api.logcat.dockBack()).then((result) => {
      // 贴回失败保留窗口并给出反馈；成功时窗口由 main 关闭，无需本地处理
      if (!result.ok) console.error('贴回主窗失败:', result.error)
    })
  }

  return (
    <Wrapper lang={locale} $darwin={window.api.platform === 'darwin'}>
      <header className="head">
        <select
          className="device-select"
          value={effectiveId ?? ''}
          aria-label={copy.logcatDeviceLabel}
          disabled={running.length === 0}
          onChange={(event) => setPickedId(event.target.value)}
        >
          {running.length === 0 ? (
            <option value="">{copy.logcatNoDevice}</option>
          ) : (
            running.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="dock-back"
          aria-label={copy.logcatDockBack}
          title={copy.logcatDockBack}
          onClick={handleDockBack}
        >
          <PanelLeftClose size={15} />
        </button>
      </header>
      <LogcatPanel
        key={`${effectiveId ?? 'none'}:${selected?.runId ?? ''}`}
        deviceId={effectiveId}
        runId={selected?.runId ?? null}
      />
    </Wrapper>
  )
}

const Wrapper = styled.div<{ $darwin: boolean }>`
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 12px;
    /* darwin 原生三灯安全区：hiddenInset 灯组右缘约 x=66，留 80px 起步 + 呼吸空隙
       （64px 会与下拉框重叠）；hiddenInset 无系统标题栏，head 即拖拽带 */
    padding-left: ${(props) => (props.$darwin ? '80px' : '12px')};
    border-bottom: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);
    -webkit-app-region: ${(props) => (props.$darwin ? 'drag' : 'no-drag')};

    .device-select {
      min-width: 0;
      max-width: 240px;
      height: 26px;
      padding: 0 6px;
      border: 1px solid var(--board-hairline);
      border-radius: 6px;
      background: var(--board-bg);
      color: var(--board-ink);
      font-size: 12px;
      -webkit-app-region: no-drag;

      &:disabled {
        opacity: 0.55;
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }

    .dock-back {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      flex: none;
      margin-left: auto;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--board-ink);
      cursor: pointer;
      -webkit-app-region: no-drag;
      transition: background-color 0.12s;

      &:hover {
        background: var(--board-hover-veil);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
  }
`

export default LogcatApp
