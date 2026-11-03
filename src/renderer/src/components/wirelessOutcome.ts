import { format } from '@shared/i18n'
import type { MainWindowCopy } from '@shared/i18n'
import type { WirelessConnectOutcome } from '@shared/types'

/** 无线连接失败 reason → 词条（连接器与行卡转无线反馈共用；纯函数供测试） */
export const wirelessConnectFailureText = (
  copy: MainWindowCopy,
  outcome: Extract<WirelessConnectOutcome, { ok: false }>
): string => {
  switch (outcome.reason) {
    case 'unreachable':
      return format(copy.wirelessFailUnreachable, { host: outcome.host })
    case 'cross-subnet':
      return format(copy.wirelessFailCrossSubnet, { host: outcome.host })
    case 'offline-race':
      return copy.wirelessFailOfflineRace
    case 'unauthorized':
      return copy.wirelessFailUnauthorized
    case 'no-wifi':
      return copy.wirelessFailNoWifi
    case 'not-found':
      return copy.wirelessFailNotFound
  }
}
