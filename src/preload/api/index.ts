import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { wizardApi } from './wizard'
import { themeApi } from './theme'
import { pocApi } from './poc'

export const api = {
  platform: process.platform,
  dialog: dialogApi,
  devices: devicesApi,
  wizard: wizardApi,
  theme: themeApi,
  poc: pocApi
}

export type Api = typeof api
