import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { sdkApi } from './sdk'
import { wizardApi } from './wizard'
import { themeApi } from './theme'
import { localeApi } from './locale'
import { screenApi } from './screen'
import { settingsApi } from './settings'
import { screenshotApi } from './screenshot'

export const api = {
  platform: process.platform,
  dialog: dialogApi,
  devices: devicesApi,
  sdk: sdkApi,
  wizard: wizardApi,
  settings: settingsApi,
  theme: themeApi,
  locale: localeApi,
  screen: screenApi,
  screenshot: screenshotApi
}

export type Api = typeof api
