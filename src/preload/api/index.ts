import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { wizardApi } from './wizard'

export const api = {
  platform: process.platform,
  dialog: dialogApi,
  devices: devicesApi,
  wizard: wizardApi
}

export type Api = typeof api
