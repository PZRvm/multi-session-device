import styled from 'styled-components'
import type { Device } from '@shared/types'
import DeviceRow from './DeviceRow'

type DeviceListPaneProps = {
  devices: Device[]
  selectedId: string | null
  onSelect: (id: string) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onCancelStart: (id: string) => void
  onCopySerial: (id: string) => void
  onDelete: (device: Device) => void
  onRename: (id: string, name: string) => void
}

/** 左栏列表区：板头（BoardHead）与底部新建钮由 App 编排，这里只管列表本体 */
const DeviceListPane = ({
  devices,
  selectedId,
  onSelect,
  onStart,
  onStop,
  onCancelStart,
  onCopySerial,
  onDelete,
  onRename
}: DeviceListPaneProps): React.JSX.Element => (
  <Wrapper>
    {devices.length === 0 ? (
      <EmptyHint>还没有设备，点左下角「新建设备」创建第一台</EmptyHint>
    ) : (
      <List>
        {devices.map((device) => (
          <DeviceRow
            key={device.id}
            device={device}
            selected={device.id === selectedId}
            onSelect={() => onSelect(device.id)}
            onStart={() => onStart(device.id)}
            onStop={() => onStop(device.id)}
            onCancelStart={() => onCancelStart(device.id)}
            onCopySerial={() => onCopySerial(device.id)}
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
  flex: 1;
  min-height: 0;
  background: var(--board-bg);
`

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;

  /* 行间发丝线（Hairline Rule） */
  & > div + div {
    border-top: 1px solid var(--board-hairline);
  }
`

const EmptyHint = styled.p`
  margin: 24px 14px;
  font-size: 12px;
  color: var(--board-ink-dim);
`

export default DeviceListPane
