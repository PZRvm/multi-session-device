import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { Device, DeviceSnapshot } from '@shared/types'
import { MAIN_COPY } from '@shared/i18n'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'
import { useLocaleStore } from '../stores/localeStore'
import LogcatPanel from '../components/LogcatPanel'

/** 独立日志窗：running 设备下拉 + 共用日志面板。关窗只是退订——会话跟设备走（plan） */
const LogcatApp = (): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const locale = useLocaleStore((state) => state.locale)
  const [devices, setDevices] = useState<Device[]>([])
  const [pickedId, setPickedId] = useState<string | null>(null)

  // 启动上下文（仅日志窗可调）+ devicesChanged 全窗广播跟随
  useEffect(() => {
    let alive = true
    void (async () => {
      const result = await toApiResult(window.api.logcat.context())
      if (alive && result.ok) setDevices(result.data.devices)
    })()
    const unbind = window.api.devices.onChanged((snapshot: DeviceSnapshot) => {
      setDevices(snapshot.devices)
    })
    return () => {
      alive = false
      unbind()
    }
  }, [])

  const running = devices.filter(
    (device) => device.status === 'running' && device.serial && device.runId
  )
  // 目标链：手选（仍 running）→ 弹出时带来的 ?device= → 首个 running；目标停止自动回退
  const initialId = new URLSearchParams(window.location.search).get('device')
  const effectiveId =
    pickedId !== null && running.some((device) => device.id === pickedId)
      ? pickedId
      : initialId !== null && running.some((device) => device.id === initialId)
        ? initialId
        : (running[0]?.id ?? null)
  const selected = running.find((device) => device.id === effectiveId) ?? null

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
    height: 40px;
    /* darwin 原生三灯安全区（hiddenInset 14×12，同设置窗） */
    padding: 0 12px;
    padding-left: ${(props) => (props.$darwin ? '64px' : '12px')};
    border-bottom: 1px solid var(--board-hairline);
    background: var(--board-bg-raised);

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

      &:disabled {
        opacity: 0.55;
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
  }
`

export default LogcatApp
