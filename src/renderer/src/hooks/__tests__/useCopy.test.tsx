import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SettingsLocale } from '@shared/i18n'
import { useCopy } from '../useCopy'
import { useLocaleStore } from '../../stores/localeStore'

const DOMAIN: Record<SettingsLocale, string> = {
  'zh-CN': '通用',
  'zh-TW': '一般',
  'en-US': 'General'
}

const Probe = (): React.JSX.Element => {
  const copy = useCopy(DOMAIN)
  return <button type="button">{copy}</button>
}

afterEach(() => {
  useLocaleStore.setState({ locale: 'zh-CN' })
})

describe('useCopy 按域取词', () => {
  it('返回当前语言文案，随 localeStore 变化重渲染（本窗切换与他窗广播同一路径）', () => {
    render(<Probe />)
    expect(screen.getByRole('button').textContent).toBe('通用')
    act(() => {
      useLocaleStore.setState({ locale: 'en-US' })
    })
    expect(screen.getByRole('button').textContent).toBe('General')
    act(() => {
      useLocaleStore.setState({ locale: 'zh-TW' })
    })
    expect(screen.getByRole('button').textContent).toBe('一般')
  })
})
