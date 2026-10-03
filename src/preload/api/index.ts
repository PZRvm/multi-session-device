import { dialogApi } from './dialog'
import { devicesApi } from './devices'

export const api = { dialog: dialogApi, devices: devicesApi }

export type Api = typeof api
