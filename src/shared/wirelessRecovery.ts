import type { SettingsLocale } from './i18n/locale'

export type WirelessDiagnosisKind =
  'service-suspected' | 'refused' | 'network' | 'unknown' | 'tcpip' | 'verification'
export interface WirelessDiagnosis {
  kind: WirelessDiagnosisKind
  tcp: 'reachable' | 'refused' | 'timeout' | 'blocked' | 'unknown'
  stage: string
  code: number
  detail: string
  adbVersion?: string
  server?: string
}
export interface WirelessRecoveryState {
  phase: 'idle' | 'confirming' | 'restarting' | 'reconnecting'
  blocked: string[]
}
export type WirelessRepairOutcome =
  { ok: true; serial: string } | { ok: false; message: string; cancelled?: boolean }

const zhCN = {
  busy: '正在修复 ADB 连接，请稍后重试',
  repair: '修复连接',
  retry: '重试',
  copy: '复制诊断',
  copied: '诊断已复制',
  confirm: '重启 ADB 并重试连接？',
  impact:
    '将重启共享 ADB，所有设备连接和 Android Studio 调试会短暂中断。其他无线设备可能需要重新连接，调试和端口转发不会自动恢复。',
  proceed: '重启并重试',
  cancel: '取消',
  working: '正在修复连接…',
  done: '无线连接已恢复，可拔掉数据线',
  expired: '诊断已过期，请重新连接后再试',
  task: '任务进行中，暂时无法修复连接：',
  recording: '录屏',
  install: '安装 APK',
  migration: 'SDK 迁移或来源切换',
  lifecycle: '模拟器启动或停止',
  commands: '设备命令尚未结束，请稍后重试',
  service: '手机端口可达，疑似 ADB 服务异常，可尝试修复连接',
  refused: '无线端口未就绪或未监听，请稍后重试',
  network: '网络或局域网访问受阻，请检查手机联网、网络隔离及局域网权限',
  unknown: '连接失败，原因未确定；可复制诊断进一步排查',
  tcpip: '开启手机无线端口失败，请检查 USB 连接及手机设置',
  verification: '无线连接尚未就绪，设备状态或命令验证失败',
  failed: '修复未完成：',
  permission: '请在系统设置的隐私与安全性中检查本应用的本地网络权限。'
}
const zhTW: typeof zhCN = {
  busy: '正在修復 ADB 連線，請稍後重試',
  repair: '修復連線',
  retry: '重試',
  copy: '複製診斷',
  copied: '診斷已複製',
  confirm: '重新啟動 ADB 並重試連線？',
  impact:
    '將重新啟動共用 ADB，所有裝置連線和 Android Studio 偵錯會短暫中斷。其他無線裝置可能需要重新連線，偵錯和連接埠轉送不會自動恢復。',
  proceed: '重新啟動並重試',
  cancel: '取消',
  working: '正在修復連線…',
  done: '無線連線已恢復，可拔掉資料線',
  expired: '診斷已過期，請重新連線後再試',
  task: '工作進行中，暫時無法修復連線：',
  recording: '錄影',
  install: '安裝 APK',
  migration: 'SDK 遷移或來源切換',
  lifecycle: '模擬器啟動或停止',
  commands: '裝置命令尚未結束，請稍後重試',
  service: '手機連接埠可達，疑似 ADB 服務異常，可嘗試修復連線',
  refused: '無線連接埠未就緒或未監聽，請稍後重試',
  network: '網路或區域網路存取受阻，請檢查手機連網、網路隔離及區域網路權限',
  unknown: '連線失敗，原因未確定；可複製診斷進一步排查',
  tcpip: '開啟手機無線連接埠失敗，請檢查 USB 連線及手機設定',
  verification: '無線連線尚未就緒，裝置狀態或命令驗證失敗',
  failed: '修復未完成：',
  permission: '請在系統設定的隱私權與安全性中檢查本應用程式的區域網路權限。'
}
const enUS: typeof zhCN = {
  busy: 'ADB connection repair is in progress. Try again shortly.',
  repair: 'Repair connection',
  retry: 'Retry',
  copy: 'Copy diagnostics',
  copied: 'Diagnostics copied',
  confirm: 'Restart ADB and retry this connection?',
  impact:
    'Restarting shared ADB briefly interrupts all device connections and Android Studio debugging. Other wireless devices may need reconnecting. Debug sessions and port forwarding will not be restored automatically.',
  proceed: 'Restart and retry',
  cancel: 'Cancel',
  working: 'Repairing connection…',
  done: 'Wireless connection restored. You can unplug USB.',
  expired: 'Diagnostics expired. Connect again to retry.',
  task: 'Connection repair is unavailable while these tasks are running: ',
  recording: 'Recording',
  install: 'APK installation',
  migration: 'SDK migration or source switch',
  lifecycle: 'Emulator starting or stopping',
  commands: 'Device commands have not finished. Try again shortly.',
  service: 'The device port is reachable. ADB may be malfunctioning; try repairing the connection.',
  refused: 'The wireless port is not ready or listening. Try again shortly.',
  network:
    'Network or local access is blocked. Check device connectivity, network isolation and local network permission.',
  unknown: 'Connection failed for an unknown reason. Copy diagnostics to investigate.',
  tcpip: 'Could not enable the wireless port. Check USB connectivity and device settings.',
  verification: 'Wireless connection is not ready: device state or command verification failed.',
  failed: 'Repair incomplete: ',
  permission: 'Check this app’s Local Network access in System Settings > Privacy & Security.'
}
export const WIRELESS_RECOVERY_COPY: Record<SettingsLocale, typeof zhCN> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS
}
