import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WirelessRecoveryFeedback from '../WirelessRecoveryFeedback'
import { useExternalStore } from '../../stores/externalStore'
const repair = vi.fn(),
  copy = vi.fn()
beforeEach(() => {
  useExternalStore.setState({ recovery: { phase: 'idle', blocked: [] } })
  Object.assign(window, {
    api: {
      devices: {
        onWirelessRecoveryChanged: () => () => {},
        getWirelessRecoveryState: async () => ({ phase: 'idle', blocked: [] }),
        repairWirelessConnection: repair,
        copyWirelessDiagnostics: copy
      }
    }
  })
  repair.mockReset()
  copy.mockReset()
})
afterEach(cleanup)
const outcome = {
  ok: false as const,
  reason: 'unreachable' as const,
  host: '192.168.31.162',
  attemptId: 'attempt',
  repairable: true
}
it('uses the owned attempt for repair and reports success', async () => {
  repair.mockResolvedValue({ ok: true, serial: '192.168.31.162:5555' })
  const done = vi.fn()
  render(<WirelessRecoveryFeedback outcome={outcome} onRetry={vi.fn()} onRecovered={done} />)
  fireEvent.click(screen.getByText('修复连接'))
  await waitFor(() => expect(done).toHaveBeenCalledWith('192.168.31.162:5555'))
  expect(repair).toHaveBeenCalledWith('attempt')
})
it('reflects main task blockers and copies diagnostics through a dedicated API', async () => {
  const devices = window.api.devices
  vi.spyOn(devices, 'getWirelessRecoveryState').mockResolvedValue({
    phase: 'idle',
    blocked: ['安装 APK']
  })
  copy.mockResolvedValue(undefined)
  render(<WirelessRecoveryFeedback outcome={outcome} onRetry={vi.fn()} onRecovered={vi.fn()} />)
  await waitFor(() =>
    expect((screen.getByText('修复连接') as HTMLButtonElement).disabled).toBe(true)
  )
  fireEvent.click(screen.getByText('复制诊断'))
  await screen.findByText('诊断已复制')
  expect(copy).toHaveBeenCalledWith('attempt')
  expect(repair).not.toHaveBeenCalled()
})
it('shows cancellation without claiming a recovered connection', async () => {
  repair.mockResolvedValue({ ok: false, cancelled: true, message: '' })
  const done = vi.fn()
  render(<WirelessRecoveryFeedback outcome={outcome} onRetry={vi.fn()} onRecovered={done} />)
  fireEvent.click(screen.getByText('修复连接'))
  await waitFor(() =>
    expect((screen.getByText('修复连接') as HTMLButtonElement).disabled).toBe(false)
  )
  expect(done).not.toHaveBeenCalled()
})
