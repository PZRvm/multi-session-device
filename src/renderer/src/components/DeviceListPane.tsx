import { Plus } from 'lucide-react'
import styled from 'styled-components'
import type { Device } from '@shared/types'
import Button from './Button'
import DeviceRow from './DeviceRow'

type DeviceListPaneProps = {
  devices: Device[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleRunning: (id: string, running: boolean) => void
  onDelete: (device: Device) => void
  onRename: (id: string, name: string) => void
  onCreate: () => void
}

/** 左栏：标题 + 新建入口 + 设备列表（唯一切换入口，无分组无过滤——PRD 2.2） */
const DeviceListPane = ({
  devices,
  selectedId,
  onSelect,
  onToggleRunning,
  onDelete,
  onRename,
  onCreate
}: DeviceListPaneProps): React.JSX.Element => (
  <Wrapper>
    <Header>
      <PaneTitle>设备</PaneTitle>
      <Button onClick={onCreate}>
        <NewLabel>
          <Plus size={14} />
          新建设备
        </NewLabel>
      </Button>
    </Header>
    {devices.length === 0 ? (
      <EmptyHint>还没有设备，点「新建设备」创建第一台</EmptyHint>
    ) : (
      <List>
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            selected={device.id === selectedId}
            onSelect={() => onSelect(device.id)}
            onToggleRunning={(running) => onToggleRunning(device.id, running)}
            onDelete={() => onDelete(device)}
            onRename={(name) => onRename(device.id, name)}
          />
        ))}
      </List>
    )}
  </Wrapper>
)

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--board-bg);
`

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
  padding: 12px;
  border-bottom: 1px solid var(--board-hairline);
`

const PaneTitle = styled.h2`
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--board-ink-dim);
`

const NewLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;

  /* 行间发丝线（Hairline Rule），首行贴头线由 Header 底边承担 */
  & > div + div {
    border-top: 1px solid var(--board-hairline);
  }
`

const EmptyHint = styled.p`
  margin: 24px 12px;
  font-size: 12px;
  color: var(--board-ink-dim);
`

export default DeviceListPane
