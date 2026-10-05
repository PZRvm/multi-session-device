/** IPC 通道名单源——三进程唯一引用点，禁止在别处手写通道字符串 */
export const IPC_CHANNELS = {
  dialogShow: 'dialog:show',
  themeSetMode: 'theme:set-mode',
  /** 主题初值同步下发（preload sendSync 首帧取值；sync 通道走 on + returnValue） */
  themeGetSync: 'theme:get-sync',
  themeSetSystemId: 'theme:set-system-id',
  /** 主题变更推送（main → 各窗）：set 落盘前广播，各窗 store 直写跟随（跨窗同步） */
  themeChanged: 'theme:changed',
  devicesList: 'devices:list',
  devicesCreate: 'devices:create',
  devicesRename: 'devices:rename',
  devicesDelete: 'devices:delete',
  devicesStart: 'devices:start',
  devicesStop: 'devices:stop',
  devicesCancelStart: 'devices:cancel-start',
  /** 复制当前登记 serial——受控文本复制通道，不开放任意剪贴板读写 */
  devicesCopySerial: 'devices:copy-serial',
  devicesChanged: 'devices:changed',
  /** 后台运行故障推送（main → 主窗）：spawn/崩溃/停止失败等，renderer 按 eventId 去重 */
  devicesRuntimeError: 'devices:runtime-error',
  // ---- 投屏与操控域（stage 04 步骤 5；仅登记主窗可用）----
  /** 登记活动视图（id=null 退订）；listener 先安装，早到包按预设 viewToken 识别 */
  screenActivate: 'screen:activate',
  /** 仅重建本设备失败的流（emulator 不重启） */
  screenRetry: 'screen:retry',
  /** main → 主窗：流状态 */
  screenState: 'screen:state',
  /** main → 主窗：有界视频包（ACK 流控） */
  screenPacket: 'screen:packet',
  /** renderer → main：包已消费回执 */
  screenAck: 'screen:ack',
  /** renderer → main：触控/按键/文本/旋转闭集 */
  screenInput: 'screen:input',
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
  sdkImageProgress: 'sdk:image-progress'
} as const
