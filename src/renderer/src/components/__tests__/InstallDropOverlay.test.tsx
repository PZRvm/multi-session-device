import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import InstallDropOverlay from '../InstallDropOverlay'
import type { ApkInstallPhase } from '../../hooks/useApkInstall'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

const renderPhase = (phase: ApkInstallPhase, busyNote = false): void => {
  render(<InstallDropOverlay phase={phase} busyNote={busyNote} deviceName="Pixel test" />)
}

it('idle 不渲染任何内容', () => {
  const { container } = render(
    <InstallDropOverlay phase={{ phase: 'idle' }} busyNote={false} deviceName="Pixel test" />
  )
  expect(container.firstElementChild).toBeNull()
})

it('dragging：提示「松开安装到 设备名」', () => {
  renderPhase({ phase: 'dragging' })
  expect(screen.getByRole('status').textContent).toContain('松开安装到 Pixel test')
})

it('installing：显示文件名与忙碌提示（busyNote）', () => {
  renderPhase({ phase: 'installing', fileName: 'app.apk' }, true)
  const status = screen.getByRole('status')
  expect(status.textContent).toContain('正在安装 app.apk…')
  expect(status.textContent).toContain('正在安装上一个 APK，请稍候')
})

it('installed：显示文件名', () => {
  renderPhase({ phase: 'installed', fileName: '应用.apk' })
  expect(screen.getByRole('status').textContent).toContain('已安装 应用.apk')
})

it('failed：显示主进程本地化错误文案', () => {
  renderPhase({ phase: 'failed', message: 'APK 安装失败：设备存储空间不足（detail）' })
  expect(screen.getByRole('status').textContent).toContain('设备存储空间不足')
})
