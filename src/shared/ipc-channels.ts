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
  wizardClose: 'wizard:close',
  // ---- SDK 域（stage 04 步骤 2 bootstrap；步骤 3 扩展镜像/画像通道）----
  sdkStatus: 'sdk:status',
  sdkBootstrap: 'sdk:bootstrap',
  /** bootstrap 进度推送（main → renderer） */
  sdkProgress: 'sdk:progress',
  sdkProfiles: 'sdk:profiles',
  sdkImages: 'sdk:images',
  sdkDownloadImage: 'sdk:download-image',
  /** 镜像下载进度推送（main → renderer） */
  sdkImageProgress: 'sdk:image-progress',
  // ---- PoC dev harness（stage 04 步骤 1，仅 MSD_POC=1 dev 环境注册；步骤 5 产品化后移除）----
  pocSetup: 'poc:setup',
  pocEmulatorStart: 'poc:emulator-start',
  pocEmulatorStop: 'poc:emulator-stop',
  /** renderer invoke 后，main 建立视频通道并以 poc:stream-port 回送 MessagePort */
  pocStreamStart: 'poc:stream-start',
  /** main → renderer：回送视频包 MessagePort（postMessage 传输） */
  pocStreamPort: 'poc:stream-port',
  pocStopStream: 'poc:stop-stream',
  pocInject: 'poc:inject',
  pocTeardown: 'poc:teardown',
  pocReport: 'poc:report',
  pocLog: 'poc:log'
} as const
