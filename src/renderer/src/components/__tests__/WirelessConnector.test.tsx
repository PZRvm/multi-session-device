import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WirelessConnector from '../WirelessConnector'
import { wirelessConnectFailureText } from '../wirelessOutcome'
import { MAIN_COPY } from '@shared/i18n'
import type { WirelessCandidate, WirelessConnectOutcome } from '@shared/types'

const copy = MAIN_COPY['zh-CN']

afterEach(cleanup)

const candidate = (over: Partial<WirelessCandidate> = {}): WirelessCandidate => ({
  source: 'subnet-scan',
  name: null,
  host: '192.168.31.102',
  port: 5555,
  ...over
})

const scanFn = vi.fn()
const connectFn = vi.fn()
const pairFn = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as { api?: unknown }).api = {
    devices: {
      scanExternalWireless: scanFn,
      connectExternalWireless: connectFn,
      pairExternalWireless: pairFn
    }
  }
})

describe('WirelessConnector', () => {
  it('打开即扫描：候选列表呈现名称 / ip:port / 来源角标 / 连接钮', async () => {
    scanFn.mockResolvedValue([
      candidate({ source: 'mdns-connect', name: 'adb-x', host: '192.168.31.50', port: 40123 }),
      candidate()
    ])
    render(<WirelessConnector onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('adb-x')).toBeTruthy()
    })
    expect(screen.getByText('192.168.31.50:40123')).toBeTruthy()
    expect(screen.getByText('192.168.31.102:5555')).toBeTruthy()
    // 两个候选各一「连接」，加手动表单常驻一枚
    expect(screen.getAllByRole('button', { name: copy.wirelessConnectAction })).toHaveLength(3)
    expect(scanFn).toHaveBeenCalledTimes(1)
  })

  it('扫描空 → 空态引导 + 手动表单常在（一等入口）', async () => {
    scanFn.mockResolvedValue([])
    render(<WirelessConnector onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessScanEmpty)).toBeTruthy()
    })
    expect(screen.getByLabelText(copy.wirelessManualHostLabel)).toBeTruthy()
  })

  it('点候选连接 → 传 host:port；成功即 onClose（设备交给 track 呈现）', async () => {
    scanFn.mockResolvedValue([candidate()])
    connectFn.mockResolvedValue({ ok: true, serial: '192.168.31.102:5555' })
    const onClose = vi.fn()
    render(<WirelessConnector onClose={onClose} />)
    const candidateButton = await waitFor(() => {
      const row = screen.getByText('192.168.31.102:5555').closest('.candidate')
      const button = row?.querySelector('button')
      expect(button).toBeTruthy()
      return button as HTMLButtonElement
    })
    fireEvent.click(candidateButton)
    await waitFor(() => {
      expect(connectFn).toHaveBeenCalledWith({ host: '192.168.31.102', port: 5555 })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('失败 outcome → reason 映射文案内联呈现（cross-subnet 带 host 插值）', async () => {
    scanFn.mockResolvedValue([candidate()])
    const outcome: WirelessConnectOutcome = {
      ok: false,
      reason: 'cross-subnet',
      host: '192.168.0.108'
    }
    connectFn.mockResolvedValue(outcome)
    render(<WirelessConnector onClose={vi.fn()} />)
    const candidateButton = await waitFor(() => {
      const row = screen.getByText('192.168.31.102:5555').closest('.candidate')
      const button = row?.querySelector('button')
      expect(button).toBeTruthy()
      return button as HTMLButtonElement
    })
    fireEvent.click(candidateButton)
    await waitFor(() => {
      expect(screen.getByText(wirelessConnectFailureText(copy, outcome))).toBeTruthy()
    })
  })

  it('手动连接：端口钉死 5555 只有 IP 框；未输 IP 时按钮禁用', async () => {
    scanFn.mockResolvedValue([])
    connectFn.mockResolvedValue({ ok: true, serial: '10.0.0.9:5555' })
    render(<WirelessConnector onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessScanEmpty)).toBeTruthy()
    })
    const submit = screen
      .getAllByRole('button', { name: copy.wirelessConnectAction })
      .find((button) => button.closest('form') !== null) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(copy.wirelessManualHostLabel), {
      target: { value: '10.0.0.9' }
    })
    await waitFor(() => {
      expect(submit.disabled).toBe(false)
    })
    fireEvent.click(submit)
    await waitFor(() => {
      expect(connectFn).toHaveBeenCalledWith({ host: '10.0.0.9' })
    })
  })

  it('配对折叠区：展开 → 三字段提交；成功提示并重扫；失败带 adb 原文', async () => {
    scanFn.mockResolvedValue([])
    pairFn.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: false,
      message: 'Failed: wrong code'
    })
    render(<WirelessConnector onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessScanEmpty)).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPairTitle }))
    fireEvent.change(screen.getByLabelText(copy.wirelessPairHostLabel), {
      target: { value: '192.168.31.60' }
    })
    fireEvent.change(screen.getByLabelText(copy.wirelessPairPortLabel), {
      target: { value: '35001' }
    })
    fireEvent.change(screen.getByLabelText(copy.wirelessPairCodeLabel), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPairSubmit }))
    await waitFor(() => {
      expect(pairFn).toHaveBeenCalledWith({ host: '192.168.31.60', port: 35001, code: '123456' })
      expect(screen.getByText(copy.wirelessPairSuccess)).toBeTruthy()
    })
    expect(scanFn).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: copy.wirelessPairSubmit }))
    await waitFor(() => {
      expect(screen.getByText(/Failed: wrong code/)).toBeTruthy()
    })
  })

  it('Escape 收口；页面内无关闭钮（原生窗三灯负责关闭）', async () => {
    scanFn.mockResolvedValue([])
    const onClose = vi.fn()
    render(<WirelessConnector onClose={onClose} />)
    await waitFor(() => {
      expect(screen.getByText(copy.wirelessScanEmpty)).toBeTruthy()
    })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: copy.cancel })).toBeNull()
  })
})
