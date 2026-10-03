import { dialogApi } from './dialog'
import { devicesApi } from './devices'
import { windowApi } from './window'
import { wizardApi } from './wizard'

export const api = {
  platform: process.platform,
  dialog: dialogApi,
  devices: devicesApi,
  wizard: wizardApi,
  window: windowApi
}

export type Api = typeof api
