---
description: stage06 第一批——USB 真机接入（track-devices-l 长连接插拔跟随 + 投屏第二桥 + 未授权引导）与 APK 拖装到真机（serialOf 组合查询 + 真机失败签名 + 「仍要安装」旗标重试）；依据 think-report 20261013013755 全批复
status: completed
created: 2026-10-13
---

# 真机 USB 接入 + APK 拖装（stage06 第一批）— plan

> 2026-10-13 实施完成（S1—S8 八步独立提交，每步 typecheck/lint/test 全绿；分支
> feature/real-device-usb-and-apk-install）。两处对设计的实现偏差（均为实现期发现更优解）：
> ①属性解析用 `key:value`（冒号）而非调研初稿的 `key=value`——adb -l 真实格式如此；
> ②「重连首帧同 runId 重发 connected」改为「代次自增强制销毁重建」——scrcpy ensureSession
> 同 runId 幂等早退，同 runId 无法复活已死会话（详见 learn 2026-10-13）。
> ③选中互斥（review P3-8 补记）：实现为呈现层互斥（外部选中时 `selectedId` 传 null，
> deviceStore 选中保留）——真机拔线后 AVD 选择自动回位，优于 plan 字面的「双向清」。
> 遗留：验收清单中需要物理设备的条目（插拔/投屏/拖装/MIUI 拦截/Android 14 旧包/kill-server
> 恢复）待用户实测，已记 issue。

- **Phase 5 code review（2026-10-13，只记录不修）**：与工具条对齐批合并走查——总体
  pass、无 P1，1 项 P2（取消退出后真机跟踪不恢复）+ 8 项 P3，
  [发现清单](../notes/issue/2026-10/2026-10-13-真机两批-review.md)。
- **review 修复批（用户批复「P2 和 P3 修复掉」，2026-10-13）**：九项全部清零——
  P2-1 退出收口挪确认分支 + resumeExternalSessions 恢复会话；P3 八项含 origin 判别
  拆桶、迟到写回守卫、真机未就绪词条、ExternalCanvas 组件测试、代次裁剪、互斥偏差
  补记等。全量 1185 项通过，[处置记录](../notes/issue/2026-10/2026-10-13-真机两批-review.md)。
- **Phase 5 增量 review 第二轮（2026-10-13，只记录不修）**：覆盖修复批与后续两个
  热修复（先插后开加固、connecting 卡住）——总体 pass，1 项 P2（真机投屏重试链路
  runId 空串被拒）+ 3 项 P3，
  [发现清单](../notes/issue/2026-10/2026-10-13-真机增量-review.md)。

调研与批复：[think-report 20261013013755](../notes/think-report/20261013013755-真机USB无线接入与APK拖装.md) 五项假设全部批复（2026-10-13）。关键批复点：①第一批 = USB + APK 拖装，WiFi 留第二批；②插拔检测用 `host:track-devices-l` 长连接推送（不用轮询）；③旧 APK 走 A 案——失败卡「仍要安装」按钮、用户确认后带旗标重试。

## Requirements brief — Step 0

### Background

真机是「操控同一台设备的窗口」（PRD I 组）：出现在设备列表、点击即投屏、可拖 APK 安装；无创建/删除/改配置，断开不关机。现状三个结构性门槛：设备列表与 DeviceSnapshot 强绑（AVD 持久化模型）；投屏会话桥只挂 emulator runner 事件；apkInstall 的 serialOf 断言 `running` 生命周期态。

### Scope

- **Affects**：`src/shared/`（types、ipc-channels、i18n 三语词条）；`src/main/emulator/adb.ts`（导出一个既有私有助手）；新增 `src/main/devices/external.ts` 及其测试；`src/main/devices/queries.ts`（+1 组合查询）；`src/main/devices/index.ts`（re-export 扩员）；`src/main/apkInstall/index.ts`（签名 + 旗标 + 结果契约）；`src/main/ipc/index.ts` 与 `src/main/index.ts`（装配与退出钩子）；`src/preload/`（api/devices、api/install、index.d.ts）；renderer（externalStore、DeviceListPane 真机区、画布分支、useApkInstall、InstallDropOverlay）。
- **Does NOT affect**：DeviceSnapshot/revision/持久化/对账域（外部设备纯内存、独立通道，不进快照）；AVD 启停/扫描/编辑域；WiFi 批全部内容（pair/connect/disconnect/scanWireless 不实现，stage06 步骤 1 的无线部分留第二批）；logcat/截屏/网络三域（假设 5：另立任务）；scrcpy 域内部（transport/会话机/流控不改，只新增装配层调用方）；`stage/06` 四个步骤保持 `[suggested]`（去标由人批准，agent 只在验收后附结果行）。
- **Boundaries**：不碰共享 adb server 生命周期（track 是普通订阅连接；server 不在时经 `ensureSharedServer` 拉起，绝不 kill-server）；不做静默 bypass（旗标重试必须经用户点击）。

### Requirement

| 约束 | 要求 |
| --- | --- |
| 插拔跟随 | track 推送帧到达后列表更新并推送主窗；无周期性子进程 spawn |
| 投屏复用 | 外部设备会话走既有 `ensureSession({id, runId, serial})`，scrcpy 域零改动 |
| 安装域通用 | serialOf 组合查询对 AVD 与真机同一入口；模拟器拖装行为回归不变 |
| 门禁 | 每步 `npm run typecheck && npm run lint && npm test` 全绿才进下一步，每步独立 commit |

## Design — Phase 2

### 1. 共享契约（src/shared/）

**types.ts**：

```ts
export interface ExternalDevice {
  /** 即 serial（稳定唯一；无线 serial 含 ':'，第二批起用） */
  id: string
  serial: string
  transport: 'usb' | 'wireless'   // serial 含 ':' 判 wireless，本批只会出现 usb
  state: 'device' | 'unauthorized' | 'offline'
  model: string | null            // 长格式 model= 缺席或短格式回退时为 null
}
/** 拖拽安装结果改为判别联合：安装失败是「结果」不是「错误」（重试需要机器可读标记） */
export type ApkInstallOutcome =
  | { ok: true; fileName: string }
  | { ok: false; message: string; canBypassLowTargetSdk: boolean }
```

**ipc-channels.ts**（新增 2 条；apkInstall 通道名不变，输入扩字段）：

```ts
devicesExternalList: 'devices:external-list'        // 主窗拉取外部设备快照（main 内存缓存）
devicesExternalChanged: 'devices:external-changed'  // main → 主窗：全量推送（main 侧 diff，变化才推）
```

**i18n**（三语，errors.ts 三段 + mainWindow 域）：errors 增 `apkInstallUserRestricted`（引导开手机「USB 安装」开关）、`apkInstallDeprecatedSdk`（旧安装包提示）、`apkExternalNotReady`（外部设备未就绪）；mainWindow 增真机区标题/空态/未授权引导/「仍要安装」按钮词条。

### 2. main：external 域（新增 src/main/devices/external.ts）

域模块，不依赖 devices/state|scan（无环），被 queries.ts 与 ipc 装配消费；导出：

- `parseTrackDevices(payload: string): Array<{ serial; state; model: string | null }>`——纯函数。行格式 `serial\tstate [product=.. model=.. device=.. transport_id=..]`：先按首个 `\t` 切 serial/state，属性区用 `(\w+)=([^\s]*)` 逐对提取（不按空白切整行——未来 mDNS 服务名含空格的同族坑）；非法行丢弃。长/短格式共用（属性可选）。
- `toExternalDevices(entries): ExternalDevice[]`——剔除 `emulator-` 前缀（AVD 归既有列表）与 `adb-` 前缀（新版 mDNS 发现占位条目），其余映射。
- `registerExternalIpc(deps)`——注册 `devices:external-list`（主窗 sender 守卫，返回缓存快照）并启动 track；幂等。`stopExternalTracking()`——before-quit 用，断 socket、清定时器。
- `externalDevicesNow(): ExternalDevice[]`——缓存快照读取（queries 组合查询消费）。

deps（全接缝可测，模式对齐 network 域）：`connect?`（socket 工厂，测试替身）、`adbPath()`、`pushTarget()`（主窗 webContents）、`isMainSender`、`ensureServer?`（默认 ensureSharedServer）、`onSession?`（会话桥事件回调）。

**track 客户端**：连 127.0.0.1:5037（连接失败先 `ensureServer(adbPath())` 拉起再试），发 `host:track-devices-l`；应答 `OKAY + hex4 + 全量列表`，此后每帧 `hex4 + 新全量列表`（无再 OKAY）。缓冲式帧循环解析（跨 chunk 半包、单 chunk 多帧都要处理）。每帧：parse → toExternalDevices → 与缓存 deepEqual，变化才更新缓存 + `devices:external-changed` 推主窗 + 发会话桥事件：
- 迁入 `state === 'device'` → `onSession({kind:'connected', device, runId})`，runId = `ext:${serial}:${epoch}`（epoch 为该 serial 的出现代次，Map 计数）；
- 消失或迁出 `device` → `onSession({kind:'removed', id})`。

FAIL 应答（极老 server 不认 `-l`）→ 回退 `host:track-devices` 短格式重试一次；仍失败进重连循环。断线（end/error/close）→ 退避重连（1s 起倍增、封顶 30s，注入定时器可测）；重连成功收到首帧后，对全部 `device` 态条目重发 `connected`（同 runId，ensureSession 幂等——scrcpy 侧 session 已亡则重建，健在则 no-op）。

### 3. main：其余接线

- **adb.ts**：把模块私有的 `tcpConnect` 加 export（唯一改动；external.ts 复用，与 `encodeAdbRequest`/`ensureSharedServer` 同批导出）。
- **queries.ts**：`serialOfDeviceId(id)`——external 表命中且 `state==='device'` → 返回 serial；命中但未就绪 → throw `apkExternalNotReady`；未命中 → 落既有 `runningDeviceSerial(id)`（AVD 路径行为不变）。
- **devices/index.ts**：re-export `registerExternalIpc / stopExternalTracking`（ipc 装配消费）。
- **ipc/index.ts**：`registerExternalIpc({adbPath: adbBinaryPath, pushTarget, isMainSender, onSession: ...})`；`onSession` 的 connected → `scrcpy.ensureSession({id, runId, serial})`，removed → `scrcpy.destroySession(id)`（runner 桥旁的第二桥，注释说明外部设备无 runner）；apkInstall 注入换 `serialOf: serialOfDeviceId`。
- **main/index.ts**：before-quit 序列里 `shutdownStreams()` 旁加 `stopExternalTracking()`。
- **apkInstall/index.ts**：`FAILURE_SIGNATURES` 增 `INSTALL_FAILED_USER_RESTRICTED → apkInstallUserRestricted`、`INSTALL_FAILED_DEPRECATED_SDK_VERSION → apkInstallDeprecatedSdk`；输入增 `allowLowTargetSdk?: boolean`（true 时 install 参数插入 `--bypass-low-target-sdk-block`）；handler 返回 `ApkInstallOutcome`——安装失败不再 throw（返回 `{ok:false, message, canBypassLowTargetSdk}`，canBypass = 命中 deprecatedSdk 签名且本次未带旗标）；busy/载荷校验错误仍 throw。

### 4. preload

- `api/devices.ts`：`listExternal(): Promise<ExternalDevice[]>` + `onExternalChanged(cb): () => void`（返回解绑，镜像 onChanged 模式）。
- `api/install.ts`：`install(deviceId, filePath, opts?: {allowLowTargetSdk?: boolean}): Promise<ApkInstallOutcome>`；`index.d.ts` 同步。

### 5. renderer（界面布局与视觉走 impeccable 技能）

- **stores/externalStore.ts**（zustand）：`devices: ExternalDevice[]`、`selectedExternalId`；挂载时 `listExternal()` 初拉 + `onExternalChanged` 订阅。与 deviceStore 的 AVD 选择并列，App 组合层判定当前画布目标（点真机行 → 画布切真机；点 AVD 行切回；两列表互斥呈现选中态）。
- **DeviceListPane**：新增「真机」分区，行卡**复用既有 AVD 行的视觉语言**（用户 2026-10-13 指定按现有列表样式渲染，不另起样式）：组头同折叠组样式（chevron + 计数）；行卡三行——① 粗体标题（model，缺省用 serial）+ 右侧类型角标换成 **USB / WiFi 图标**（接入方式靠图标传达，同现有机型角标位）；② 状态点（已连接=常规色、未授权=警示色、离线=灰）+ 点分隔元信息 `型号 · serial · 状态`（无线 serial 本身即 ip:port）；③ 未授权/离线时的引导行（同现有警示行样式：手机侧授权指引，撤销重授权路径）。真机行第一批**无内联操作图标**（无启停/编辑/删除；点击行即选中投屏，第二批无线批再加「断开」）。无真机时一条 muted 空态行「未检测到真机，USB 连接并打开调试后自动出现」。USB 与 WiFi 同区混排、靠角标与 serial 形态区分，不拆两个分区。像素级细节走 impeccable。
- **画布分支**：外部设备画布复用既有投屏渲染（viewToken/screenActivate 机制不变，id 用外部 serial）+ `useApkInstall` 拖拽安装；画布 key 用外部 id。
- **useApkInstall**：failed phase 增 `canBypass?: true` 字段与 `retryWithBypass()`（以同一 filePath 带 `allowLowTargetSdk: true` 重发）；`startInstall` 改读 `ApkInstallOutcome`（throw 型错误仍走 toApiResult）。
- **InstallDropOverlay**：failed 卡在 `canBypass` 时展示「仍要安装」按钮 → 触发 retryWithBypass。

### 6. 测试布局

- `src/main/devices/__tests__/external.test.ts`：parser（长/短格式、跨 chunk 碎片、多帧连发、非法行、`emulator-`/`adb-` 剔除）；diff 事件序列（出现/消失/状态迁移/unauthorized 不建会话）；重连（connect 替身模拟断线 → ensureServer 被调 → 重连首帧全量重发 connected；退避注入定时器）；list 通道 sender 守卫。
- apkInstall 既有测试更新 + 新增：签名 ×2 映射、旗标参数拼装、outcome 契约、canBypass 判定（命中且未带旗标才 true）。
- queries：`serialOfDeviceId` 三分支。
- renderer 组件/hook 测试按既有模式补（真机区渲染、overlay 重试按钮、hook outcome 流转）。

## 实施顺序（每步全绿门禁 + 独立 commit）

1. **S1 共享契约**：types + ipc-channels + 三语词条。纯新增，零行为变化。
2. **S2 adb.ts**：export tcpConnect。
3. **S3 external.ts + 测试**：域模块成型，未接装配（无运行时影响）。
4. **S4 装配**：ipc/index.ts（注册 + 会话桥 + serialOf 换注入）+ main/index.ts（退出钩子）+ devices/index.ts re-export。
5. **S5 apkInstall 扩展 + 测试**：签名、旗标、outcome 契约（类型变化驱动 preload/hook 后续步骤，不留半改状态——此步内 preload 类型声明同步跟进或并入 S6 首个 commit）。
6. **S6 preload**：devices/install api + index.d.ts。
7. **S7 renderer**：externalStore → 列表真机区 → 画布分支 → hook/overlay 重试（impeccable）。
8. **S8 验收 + 收尾**：下述清单过一遍；stage06 附结果行（`[suggested]` 保持）；learn/issue；`npm run book:index`。

## 验收清单

- USB 插入 → 真机区秒级出现（track 推送，无轮询延迟）；拔线 → 消失且投屏会话销毁。
- 未授权态展示引导；手机授权后转 device 并可投屏。
- 点击真机 → 投屏触控/中文输入/旋转正常；与模拟器并行互不干扰（AVD 列表/启停/拖装回归不变）。
- 拖 APK 到真机画布安装成功；targetSdk<23 旧 APK 到 Android 14+ 真机（或 API 34+ 模拟器）→ 失败卡出「仍要安装」→ 点击后装上；MIUI 拦截 → 词条引导（无小米设备则记 issue 待验）。
- `adb kill-server` 后应用自动重连恢复列表（不重启应用）。

## 风险与兜底

- **TCP 粘包/半包**：缓冲帧循环解析，测试覆盖跨 chunk 切割与单 chunk 多帧。
- **极老 server 不认 `-l`**：FAIL → 短格式回退（model 为 null，UI 容忍缺省）；再不行进退避重连。
- **server 重启窗口列表陈旧**：断线保持末次快照（不清空、不误发 removed）；重连首帧全量重发 connected 校正会话。
- **adb 缺失/SDK 未就绪**：启动失败进退避循环，外部列表空，不阻塞其余功能。
- **outcome 契约迁移**：S5 与 S6/S7 间类型不匹配会编译失败——由类型系统兜底，不留静默中间态。
