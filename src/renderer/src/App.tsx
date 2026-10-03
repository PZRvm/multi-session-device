import { useState } from 'react'
import styled from 'styled-components'
import { useAppStore } from './stores/appStore'
import { useThemeStore, type ThemeMode } from './stores/themeStore'
import { toApiResult } from './api'
import Button from './components/Button'
import Divider from './components/Divider'
import Input from './components/Input'
import ListRow from './components/ListRow'
import SegmentedControl from './components/SegmentedControl'

const modeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '亮' },
  { value: 'dark', label: '暗' }
]

const App = (): React.JSX.Element => {
  const count = useAppStore((state) => state.count)
  const increment = useAppStore((state) => state.increment)
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const [lastResult, setLastResult] = useState('无')
  const [sessionName, setSessionName] = useState('')
  const [selectedRow, setSelectedRow] = useState('pixel-8')

  const showConfirm = async (): Promise<void> => {
    const result = await toApiResult(
      window.api.dialog.show({
        title: '骨架自检 · 确认框',
        message: '多按钮确认框',
        detail: '点了哪个按钮，下方就显示哪个下标（按 Esc 应返回 0）',
        buttons: ['取消', '确定'],
        cancelId: 0
      })
    )
    if (result.ok) setLastResult(`确认框返回下标 ${result.data.response}`)
    else setLastResult(`对话框出错：${result.error}`)
  }

  const showAlert = async (): Promise<void> => {
    const result = await toApiResult(
      window.api.dialog.show({
        title: '骨架自检 · 提示',
        message: '单按钮提示弹窗（原 toast 的替代形态）',
        buttons: ['知道了']
      })
    )
    if (result.ok) setLastResult('提示框已关闭')
    else setLastResult(`对话框出错：${result.error}`)
  }

  return (
    <Wrapper>
      <Header>
        <h1>多会话设备 · 骨架自检</h1>
        <SegmentedControl
          options={modeOptions}
          value={mode}
          onChange={setMode}
          ariaLabel="外观模式"
        />
      </Header>

      <SectionLabel>元素基线 · 按钮 / 输入</SectionLabel>
      <ButtonRow>
        <Button variant="primary" onClick={showConfirm}>
          原生确认框（primary）
        </Button>
        <Button onClick={showAlert}>原生提示框（ghost）</Button>
        <Input
          value={sessionName}
          onChange={(event) => setSessionName(event.target.value)}
          placeholder="会话名称"
        />
      </ButtonRow>

      <Divider />

      <SectionLabel>元素基线 · 列表行（选中 = 整行反白）</SectionLabel>
      <ListBlock>
        <ListRow
          title="Android · Pixel 8"
          subtitle="运行中 · scrcpy 通道就绪"
          selected={selectedRow === 'pixel-8'}
          onSelect={() => setSelectedRow('pixel-8')}
        />
        <ListRow
          title="Android · Pixel 8（副本）"
          subtitle="空闲"
          selected={selectedRow === 'pixel-8-copy'}
          onSelect={() => setSelectedRow('pixel-8-copy')}
        />
        <ListRow
          title="iOS · iPhone 16"
          subtitle="空闲 · stage 04 接入"
          selected={selectedRow === 'iphone-16'}
          onSelect={() => setSelectedRow('iphone-16')}
        />
      </ListBlock>

      <Divider />

      <StatusLine>
        计数：{count} ｜ 最近对话框结果：{lastResult} ｜ 输入值：{sessionName || '（空）'}
      </StatusLine>
      <ButtonRow>
        <Button onClick={increment}>zustand 计数 +1</Button>
      </ButtonRow>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  max-width: 560px;
  margin: 48px auto;
  padding: 0 24px;
`

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--board-hairline);

  & h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.5;
  }
`

const SectionLabel = styled.p`
  margin: 14px 0 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--board-ink-dim);
`

const ButtonRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
`

const ListBlock = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--board-hairline);

  & > button:first-child {
    border-top: none;
  }
`

const StatusLine = styled.p`
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--board-ink-dim);
`

export default App
