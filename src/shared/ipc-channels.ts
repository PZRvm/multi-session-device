/** IPC 通道名单源——三进程唯一引用点，禁止在别处手写通道字符串 */
export const IPC_CHANNELS = {
  dialogShow: 'dialog:show',
  themeSetMode: 'theme:set-mode',
  devicesList: 'devices:list',
  devicesCreate: 'devices:create',
  devicesRename: 'devices:rename',
  devicesDelete: 'devices:delete',
  devicesSetRunning: 'devices:set-running',
  devicesChanged: 'devices:changed',
  wizardOpen: 'wizard:open',
  wizardClose: 'wizard:close'
} as const
