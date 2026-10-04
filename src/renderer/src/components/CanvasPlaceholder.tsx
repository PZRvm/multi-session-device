import { Plus } from 'lucide-react'
import styled from 'styled-components'
import type { Device } from '@shared/types'
import Button from './Button'

const STATE_HINTS: Record<Device['status'], string> = {
  creating: '正在创建 AVD，完成后可启动',
  stopped: '设备已停止，从左侧列表启动它',
  starting: '正在启动模拟器，等待系统 boot 完成',
  running: '设备运行中，投屏与操控在下一步接入',
  stopping: '正在停止模拟器并回收端口',
  deleting: '正在删除 AVD 与元数据'
}

type CanvasPlaceholderProps = {
  device: Device | null
  onCreate: () => void
}

/** 右栏画面占位区：反映选中设备的真实状态；投屏（DeviceCanvas）在步骤 5 接入 */
const CanvasPlaceholder = ({ device, onCreate }: CanvasPlaceholderProps): React.JSX.Element => (
  <Wrapper>
    {device ? (
      <>
        <Title>{device.name}</Title>
        <Hint>{STATE_HINTS[device.status]}</Hint>
        {device.serial ? <SubHint>serial：{device.serial}</SubHint> : null}
        {device.lastError ? <ErrorHint>{device.lastError.message}</ErrorHint> : null}
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
  font-family: ui-monospace, monospace;
`

const ErrorHint = styled.p`
  margin: 4px 0 0;
  max-width: 420px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--board-tile-ink);
`

const NewLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`

export default CanvasPlaceholder
