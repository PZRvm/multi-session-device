import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { wizardApi } from './wizard'
import { themeApi } from './theme'

export const api = {
  platform: process.platform,
  dialog: dialogApi,
  devices: devicesApi,
  wizard: wizardApi,
  theme: themeApi
}

export type Api = typeof api
