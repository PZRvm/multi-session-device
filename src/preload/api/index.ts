import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { sdkApi } from './sdk'
import { wizardApi } from './wizard'
import { themeApi } from './theme'
import { localeApi } from './locale'
import { screenApi } from './screen'
import { settingsApi } from './settings'
import { screenshotApi } from './screenshot'
import { installApi } from './install'
import { networkApi } from './network'
import { logcatApi } from './logcat'
import { reportApi } from './report'

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
  screenshot: screenshotApi,
  install: installApi,
  network: networkApi,
  logcat: logcatApi,
  report: reportApi
}

export type Api = typeof api
