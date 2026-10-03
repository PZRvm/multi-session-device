import { Plus } from 'lucide-react'
import styled from 'styled-components'
import type { Device } from '@shared/types'
import Button from './Button'

type CanvasPlaceholderProps = {
  device: Device | null
  onCreate: () => void
}

/** 右栏画面占位区：stage 04 在这里接模拟器投屏（DeviceCanvas） */
const CanvasPlaceholder = ({ device, onCreate }: CanvasPlaceholderProps): React.JSX.Element => (
  <Wrapper>
    {device ? (
      <>
        <Title>{device.name}</Title>
        <Hint>设备画面将在 stage 04 接入模拟器投屏</Hint>
        <SubHint>当前为会话管理壳：列表与启停均为 mock 交互</SubHint>
      </>
    ) : (
      <>
        <Title>还没有设备</Title>
        <Hint>三步创建一台：选画像 → 选镜像 → 命名</Hint>
        <Button variant="primary" onClick={onCreate}>
          <NewLabel>
            <Plus size={14} />
            新建设备
          </NewLabel>
        </Button>
      </>
    )}
  </Wrapper>
)

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 100%;
  min-width: 0;
  padding: 24px;
  text-align: center;
`

const Title = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--board-ink);
`

const Hint = styled.p`
  margin: 0;
  font-size: 12px;
  color: var(--board-ink-dim);
`

const SubHint = styled.p`
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--board-ink-dim);
`

const NewLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`

export default CanvasPlaceholder
