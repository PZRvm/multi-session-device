import WirelessConnector from '../components/WirelessConnector'

/** 无线连接原生窗（2026-10-15 用户裁定：渲染层弹层改 mac 原生弹窗）。窗体由
 *  window/wireless.ts 创建（hiddenInset 三灯即关闭），这里只承载连接器页面；
 *  连接成功即关窗——设备经 track 推送出现在主窗列表。 */
const WirelessApp = (): React.JSX.Element => <WirelessConnector onClose={() => window.close()} />

export default WirelessApp
