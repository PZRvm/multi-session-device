import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { sdkApi } from './sdk'
import { wizardApi } from './wizard'
import { themeApi } from './theme'
import { screenApi } from './screen'
import { settingsApi } from './settings'

export const api = {
  platform: process.platform,
  dialog: dialogApi,
  devices: devicesApi,
  sdk: sdkApi,
  wizard: wizardApi,
  settings: settingsApi,
  theme: themeApi,
  screen: screenApi
}

export type Api = typeof api
