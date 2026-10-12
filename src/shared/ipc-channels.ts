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
  // ---- SDK 来源域（plan 2026-10-11-sdk-source-switching；仅设置窗）----
  /** 来源快照：source/三根路径/检测缓存/保留根清单/迁移视图（读缓存不触发扫描） */
  sdkSourceGet: 'sdk:source-get',
  /** 跑 Studio/SDK 检测链并刷新缓存（设置页打开的自动检测与「重新检测」共用） */
  sdkDetectStudio: 'sdk:detect-studio',
  /** 矩阵判定：direct（已执行）/ needs-migration / needs-choice / rejected */
  sdkSourceSet: 'sdk:source-set',
  /** 开始迁移（journal 在场 = 崩溃恢复继续；预检服务端重验） */
  sdkSourceMigrate: 'sdk:source-migrate',
  /** 直接使用分支：翻 source + relink + 删落选根（确认在 UI 完成） */
  sdkSourceAdopt: 'sdk:source-adopt',
  /** 取消 = 回滚（在途 abort 后回滚；崩溃恢复横幅同入口） */
  sdkSourceMigrateCancel: 'sdk:source-migrate-cancel',
  /** 清除保留根（仅共享模式；原生确认在 UI 完成） */
  sdkSourceClearRetained: 'sdk:source-clear-retained',
  /** 原生目录选择器选自选 SDK 根（仅设置窗；null = 用户取消） */
  sdkChooseCustomRoot: 'sdk:choose-custom-root',
  /** 来源变化广播（main → 各窗） */
  sdkSourceChanged: 'sdk:source-changed',
  /** 迁移进度推送（main → 各窗；100ms 节流 + 阶段切换必推） */
  sdkMigrateProgress: 'sdk:migrate-progress',
  // ---- 截屏域（plan 2026-10-10-screenshot-clipboard-save；仅登记主窗）----
  /** 截屏并写系统剪贴板（受控：只写本设备刚截的图，不开放任意剪贴板写入） */
  screenshotCapture: 'screenshot:capture',
  /** 用主进程缓存的最近一张写系统下载目录（不弹保存对话框） */
  screenshotSave: 'screenshot:save',
  // ---- APK 安装域（plan 2026-10-10-drag-apk-install；仅登记主窗）----
  /** 拖拽 APK 安装到 running 设备（每设备串行；结果一次返回，无进度推送） */
  apkInstall: 'apk:install',
  // ---- 网络开关域（plan 2026-10-12-network-switch-group；仅登记主窗）----
  /** 下发飞行模式/Wi-Fi/移动数据开关（命令成功后立即读回；以读回为准，不做乐观态） */
  networkSet: 'network:set',
  /** main → 主窗：网络态变化推送（1s 轮询 + 下发读回，值变化才推） */
  networkChanged: 'network:changed',
  /** 主窗拉当前网络态快照（main 内存 lastStates；刷新后恢复初值用，review P3-1） */
  networkGet: 'network:get',
  // ---- 日志域（plan 2026-10-10-logcat-panel）----
  // 与投屏域的刻意差异：任意窗口可订阅（非仅主窗）、流控允许丢最旧保最新（非不可丢）。
  /** 窗口订阅设备日志（回放缓冲尾 500 行 + 实时）；任意窗口可调 */
  logcatSubscribe: 'logcat:subscribe',
  // ---- 对账详情窗（plan 2026-10-12-reconcile-report-panel 子窗口方案）----
  /** 主窗请求打开对账详情窗（单例；已开则聚焦） */
  reportWindowOpen: 'report-window:open',
  /** 在 Finder 中显示文件（孤立组处置入口；路径白名单校验在 main） */
  shellShowItemInFolder: 'shell:show-item-in-folder',
  /** 窗口退订单设备（关窗由 main 侧 destroyed 钩子统一清理） */
  logcatUnsubscribe: 'logcat:unsubscribe',
  /** main → 各窗：批量日志行（250ms 或 200 行触发 flush；dropped 为流控丢弃计数） */
  logcatBatch: 'logcat:batch',
  /** 窗口 → main：批次回执（流控，镜像 screenAck；按 upToSeq 确认） */
  logcatAck: 'logcat:ack',
  /** 日志窗启动上下文（仅日志窗）：当前设备快照（下拉用） */
  logcatContext: 'logcat:context',
  /** 主窗调：开/聚焦独立日志窗（单例；可带 device 查询参数） */
  logcatWindowOpen: 'logcat:window-open',
  /** 主窗调：独立日志窗是否开着（开合 dock 前判定——开着则点击 = 聚焦） */
  logcatWindowState: 'logcat:window-state',
  /** 日志窗「贴回」：日志窗发 → main 关日志窗并通知主窗展开 dock */
  logcatDockBack: 'logcat:dock-back',
  /** 主窗调：dock 展开态同步——展开时锁主窗 minWidth（不够宽则拉宽），收起解锁 */
  logcatDockState: 'logcat:dock-state'
} as const
