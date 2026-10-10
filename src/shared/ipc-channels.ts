/** IPC 通道名单源——三进程唯一引用点，禁止在别处手写通道字符串 */
export const IPC_CHANNELS = {
  dialogShow: 'dialog:show',
  themeSetMode: 'theme:set-mode',
  /** 主题初值同步下发（preload sendSync 首帧取值；sync 通道走 on + returnValue） */
  themeGetSync: 'theme:get-sync',
  themeSetSystemId: 'theme:set-system-id',
  /** 主题变更推送（main → 各窗）：set 落盘前广播，各窗 store 直写跟随（跨窗同步） */
  themeChanged: 'theme:changed',
  // ---- 界面语言域（plan 2026-10-10-i18n-and-appearance 批 1；三件套镜像 theme）----
  localeSet: 'locale:set',
  /** 语言初值同步下发（preload sendSync 取值；sync 通道走 on + returnValue） */
  localeGetSync: 'locale:get-sync',
  /** 语言变更推送（main → 各窗）：set 落盘前广播，各窗 store 直写跟随（跨窗同步） */
  localeChanged: 'locale:changed',
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
  // ---- 持久化对账域（plan 2026-10-05-avd-reconciliation；仅登记主窗）----
  /** 人工重查：受控重读元数据 + AVD/镜像只读核验，返回合并快照与本轮报告 */
  devicesReconcile: 'devices:reconcile',
  /** 拉取最近一次对账报告（不触发隐式扫描；无报告返回 null） */
  devicesReconciliationReport: 'devices:reconciliation-report',
  /** 确认已展示某签名的异常汇总（迟到签名不消费新异常） */
  devicesReconciliationAck: 'devices:reconciliation-ack',
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
  settingsOpen: 'settings:open',
  // ---- 设备配置编辑域（plan 2026-10-08-device-config-edit）----
  /** 主窗调：为指定设备开/聚焦编辑窗（上下文创建时固定，不静默切换已有窗） */
  wizardOpenEditor: 'wizard:open-editor',
  /** 向导窗自己调：读取本窗口固定的 create/edit 上下文 */
  wizardContext: 'wizard:context',
  /** 编辑窗读取配置快照（回填草稿；仅绑定该设备的编辑窗，只读） */
  devicesReadConfig: 'devices:read-config',
  /** 编辑窗提交名称/白名单字段差异（写前指纹复验 + 跨文件事务） */
  devicesUpdateConfig: 'devices:update-config',
  // ---- SDK 域（stage 04 步骤 2 bootstrap；步骤 3 扩展镜像/画像通道）----
  sdkStatus: 'sdk:status',
  sdkBootstrap: 'sdk:bootstrap',
  /** bootstrap 进度推送（main → renderer） */
  sdkProgress: 'sdk:progress',
  sdkProfiles: 'sdk:profiles',
  sdkImages: 'sdk:images',
  sdkDownloadImage: 'sdk:download-image',
  /** 取消进行中的镜像下载（仅向导窗；幂等——无任务/包名不匹配直接成功） */
  sdkCancelDownloadImage: 'sdk:cancel-download-image',
  /** 卸载已装系统镜像（设备引用守卫 + 官方 --uninstall 路径） */
  sdkUninstallImage: 'sdk:uninstall-image',
  /** 镜像下载进度推送（main → renderer） */
  sdkImageProgress: 'sdk:image-progress',
  /** 卸载终态广播（main → renderer）：完成或失败 */
  sdkUninstallState: 'sdk:uninstall-state',
  /** 向导设置能力：defaults/枚举/边界/禁用原因（按画像×镜像×emulator 版本） */
  sdkWizardCapabilities: 'sdk:wizard-capabilities',
  /** 机型皮肤清单（SDK 已装 + 导入/下载库；主窗与向导只读） */
  sdkDeviceSkins: 'sdk:device-skins',
  sdkDeviceSkinPresentation: 'sdk:device-skin-presentation',
  sdkCameraAccess: 'sdk:camera-access',
  sdkCameraSettings: 'sdk:camera-settings',
  /** 原生文件选择器选皮肤压缩包并导入（仅向导窗） */
  wizardChooseDeviceSkin: 'wizard:choose-device-skin',
  /** 受控下载官方皮肤（仅向导窗） */
  sdkDownloadDeviceSkin: 'sdk:download-device-skin',
  /** 皮肤下载进度推送（main → renderer） */
  sdkSkinProgress: 'sdk:skin-progress',
  // ---- APK 安装域（plan 2026-10-10-drag-apk-install；仅登记主窗）----
  /** 拖拽 APK 安装到 running 设备（每设备串行；结果一次返回，无进度推送） */
  apkInstall: 'apk:install'
} as const
