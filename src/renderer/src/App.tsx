import { useState } from 'react'
import styled from 'styled-components'
import { Play } from 'lucide-react'
import { useAppStore } from './stores/appStore'
import { toApiResult } from './api'

const App = (): React.JSX.Element => {
  const count = useAppStore((state) => state.count)
  const increment = useAppStore((state) => state.increment)
  const [lastResult, setLastResult] = useState('无')

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
      <h1>多会话设备 · 骨架自检</h1>
      <p className="icon-line">
        <Play size={14} /> lucide 图标渲染正常
      </p>
      <div className="actions">
        <button type="button" onClick={increment}>
          zustand 计数 +1
        </button>
        <button type="button" onClick={showConfirm}>
          原生确认框
        </button>
        <button type="button" onClick={showAlert}>
          原生提示框
        </button>
      </div>
      <p className="status">
        计数：{count} ｜ 最近对话框结果：{lastResult}
      </p>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
  margin: 48px auto;
  padding: 0 24px;
  color: #1f2328;

  & h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }

  & .icon-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 13px;
    color: #59636e;
  }

  & .actions {
    display: flex;
    gap: 8px;
  }

  & button {
    padding: 6px 14px;
    border: 1px solid #d1d9e0;
    border-radius: 6px;
    background: #f6f8fa;
    font-size: 13px;
    cursor: pointer;

    &:hover {
      border-color: #a8b3bf;
    }
  }

  & .status {
    margin: 0;
    font-size: 13px;
    color: #59636e;
  }
`

export default App
