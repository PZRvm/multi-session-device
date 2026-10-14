---
description: stage06 第二批——真机无线接入：荣耀/华为系「一键转无线」（tcpip 5555 → 读 wlan0 IP → connect，覆盖 adbd 重启竞态）为无持久化主路径；mDNS 扫描 + 配对码走小米等有官方无线调试开关的机型（验收待用户持机手动执行）；网段扫描与手动 IP:5555 为辅助入口。端口钉死 5555，不存设备记录，USB/无线双条目并存不聚合
status: in_progress
created: 2026-10-15
---

# 真机无线接入（stage06 第二批）— plan

> 2026-10-15 实施完成（S1—S4 四步独立提交，分支 feature/real-device-wireless，
> typecheck/lint/全量 1230 测试全绿，基线 +38；开发期 dev 冒烟通过）。对设计的两处
> 实现补充：①`devices:external-promote` 第五通道——plan 通道清单漏列「转无线」的
> invoke 入口，实现期补；②连接器弹层为非模态卡（对齐 ScreenshotPopover 先例）而非
> 模态对话框。验收清单需物理设备条目（荣耀实测 + 小米 mDNS/配对）待用户手动执行，
> [验收 issue](../notes/issue/2026-10/2026-10-15-真机无线批硬件验收待执行.md)——
> 通过销账后翻 completed。

> 2026-10-15 会话内实测定调（荣耀 30 Pro / EBG_AN00 / Android 12 / Magic UI 4.1）：
> 荣耀与华为系系统**没有**「无线调试」开关（华为官方支持页明确「没有无线调试设置项」，
> 荣耀俱乐部有用户催加未果），mDNS 永远发现不了它们——经典 `adb tcpip 5555` 是唯一
> 路径。该路径已在本机全链路手工打通：插线 → tcpip → connect 192.168.31.102:5555 →
> 拔线后无线 transport 稳定 `device` 态、命令正常；track 长连接与真机区列表**零改动**
> 兼容无线条目（Wi-Fi 角标自动出现，见当日会话截图）。
> 用户五项裁定（2026-10-15）：①端口固定 5555 不做可配置；②不持久化设备记录、不做
> 断线找回——「检测到就用，没了就没了」；③USB 与无线双条目并存，不聚合不去重；④转
> 无线流程不设「待拔线」过渡态，拔线后 USB 条目自然消失；⑤小米配对流程照做，硬件
> 验收留用户拿到设备后手动执行（复刻第一批硬件验收 issue 模式）。

## Requirements brief — Step 0

### Background

第一批留下四条接缝：external.ts 的 pairDevice / connectDevice / disconnectDevice /
scanWireless 未实现，无线 IPC 通道与无线连接器 UI 未建。当日实测补齐了三块事实：
荣耀系无官方开关（tcpip 是唯一路径）；`tcpip` 下发后 adbd 重启存在数秒不应答窗口
（connect 需重试）；跨网段 + 代理 TUN 会吞掉发往手机的流量（同网段免疫——macOS 对
on-link 流量走 en0 直连）。会话另发现荣耀 30 Pro 的 USB serial 会漂移
（DSLDU↔DSLU，已记 issue，本批不处理）。

### Scope

- **Affects**：`src/shared/`（ipc-channels +4 条、i18n 三语词条、types 若干输入/结果契
  约）；`src/main/devices/external.ts`（新增无线四函数 + 网段探测助手，接缝注入可单
  测）；`src/main/devices/ipc.ts` 或 `src/main/ipc/index.ts`（通道装配）；`src/preload/`
  （api/devices 四方法 + index.d.ts）；renderer（externalStore 扩动作、真机区行卡内联
  操作、无线连接器弹层/表单）。
- **Does NOT affect**：track 长连接与会话桥（实测零改动兼容无线，本批不碰）；scrcpy 域；
  DeviceSnapshot/持久化域（无状态裁定：不存任何无线设备记录）；AVD 列表/启停/编辑域；
  APK 安装域（serialOfDeviceId 对无线 serial 天然适用）；共享 adb server 生命周期红线
  （只 start 不 kill 照旧）。
- **Boundaries**：不静默重连（无持久化裁定：断线不自动找回，用户手动再连）；不做跨网
  段连通性黑魔法（只提示，不代理绕行）；serial 漂移不修（issue 记录）。

### Requirement

| 约束 | 要求 |
| --- | --- |
| 端口 | 钉死 5555，无配置项（adbd 每机各听各的，IP 已区分，可配置零收益） |
| 无状态 | 不落任何设备记录/别名表/最后 IP；应用重启后无线设备不自动恢复 |
| 转无线 | USB 行卡一键触发，成功即提示拔线；adbd 重启竞态由重试吸收 |
| 并存 | USB+无线双条目各自建会话，互不干扰；拔线仅销毁 USB 条目 |
| 门禁 | 每步 typecheck/lint/test 全绿 + 独立 commit（对齐第一批） |

## Design — Phase 2

### 1. 共享契约（src/shared/）

**ipc-channels.ts**（+4 条 invoke 型）：

```ts
devicesExternalScan: 'devices:external-scan'            // 扫描：mDNS 服务 + 本网段 5555 探活
devicesExternalPair: 'devices:external-pair'            // 配对码（小米系官方无线调试）
devicesExternalConnect: 'devices:external-connect'      // 直连 host[:5555]
devicesExternalDisconnect: 'devices:external-disconnect' // 断开（含「转无线」拔线后的无线条目）
```

**types.ts**（输入/结果契约）：

```ts
export interface WirelessCandidate {
  source: 'mdns-connect' | 'mdns-pairing' | 'subnet-scan'
  name: string | null      // mDNS 实例名（可含空格）；网段扫描为 null
  host: string             // IP
  port: number             // 5555 或 mDNS 报告端口
}
export interface WirelessConnectInput { host: string; port?: number /* 缺省 5555 */ }
export interface WirelessPairInput { host: string; port: number; code: string }
/** 失败是结果不是错误：reason 机器可读，hint 供 UI 直接展示 */
export type WirelessConnectOutcome =
  | { ok: true; serial: string }                    // 'ip:port'
  | { ok: false; reason: 'unreachable' | 'offline-race' | 'cross-subnet' | 'unauthorized'; host: string }
```

### 2. main：external.ts 无线四函数（全接缝注入）

deps 扩员（模式对齐既有）：`runCmd?`（默认 runAdb 封装，替身断言参数序列）、
`probeTcp?`（默认 node:net 网段探活）、`timer?`（默认 setTimeout，退避可测）、
`localSubnets?`（默认 os.networkInterfaces 解析非内网 IPv4/24）。

- **`promoteToWireless(serial)`**——荣耀/华为系主路径。顺序：①`adb -s <serial> shell
  ip route` 解析 wlan0 默认路由源地址（正则提 `src <ip>`；无 wlan0 → 报错「手机未连
  Wi-Fi」）；②`adb -s <serial> tcpip 5555`；③走 `connectDevice(ip, 5555)`（重试吸收
  adbd 重启竞态）。先读 IP 再 tcpip——避免 adbd 重启窗口干扰 shell。
- **`connectDevice({host, port = 5555})`**——`adb connect host:port`，之后经
  `host:devices` 短格式查询该 serial 状态：`device` → ok；`offline` → 竞态签名，退避
  重试（1s/2s/4s/8s/16s 共 5 次，注入 timer）；连不上（TCP 层失败）→ 先查
  `localSubnets` 含不含目标网段：不含 → `cross-subnet`（UI 提示「Mac 与手机需连同一
  Wi-Fi；若已同网仍失败，检查代理 TUN 是否放行局域网」），含 → `unreachable`。
- **`disconnectDevice(serial)`**——`adb disconnect <serial>`；track 自然推消失、会话
  桥销毁（既有链路，零新增）。
- **`scanWireless()`**——两源合并：①`adb mdns services` 解析（**按服务类型后缀
  `_adb-tls-connect._tcp` / `_adb-tls-pairing._tcp` 匹配行，取行尾最后一个空白分隔
  token 作 ip:port**——实例名可含空格的坑已知，绝不按空白切整行）；mdns daemon 未启
  或输出空 → 该源静默为空列表（手动输入兜底）；②网段探活——对每个本机 IPv4/24 并行
  TCP 探 5555（并发全开、单点 1s 超时，254 地址数秒级），命中即 `subnet-scan` 候选
  （名字 null，连上后 track 的 model 字段自然补全）。同网段探活走 on-link 直连路由，
  代理 TUN 不劫持（当日实测验证）；跨网段候选根本不会出现在本网段扫描里。
- **`pairDevice({host, port, code})`**——`adb pair host:port code`，输出含
  `Successfully paired` 判成功；配对端口是临时的、≠连接端口，配对成功后 UI 引导回到
  扫描列表选 `_adb-tls-connect` 条目连接（链在 UI 层，域函数保持单一职责）。

会话/列表零改动：无线 serial 迁入 track 即建会话（实测已验）；双条目并存不聚合
（用户裁定③）；拔线仅 USB 条目消失。

### 3. preload + renderer

- **api/devices.ts**：`scanWireless()` / `pairWireless(input)` / `connectWireless(input)`
  / `disconnectExternal(serial)`；index.d.ts 同步。
- **externalStore**：扩四个 action + 进行中/结果态（不持久化——刷新即丢，裁定②）。
- **真机区行卡**（impeccable）：USB 行 `device` 态加「转为无线」内联按钮（点击 →
  promote → 成功 toast 提示拔线）；无线行加「断开」按钮（第一批 plan 已预告）。无线
  未授权态复用既有引导行样式（RSA 撤销场景）。
- **无线连接器**（弹层，双入口打开）：①真机区组头右侧常驻「无线连接」图标按钮
  （与 chevron+计数同行；组头现结构是单 button，需拆成容器 div + 两个按钮——按钮嵌
  按钮不合法）；②空态行（`real-empty`）追加内联「连接无线设备」动作——一台真机都
  没有时恰是用户最需要入口的时刻。弹层内容三块——扫描结果列表（来源角标 + 名称/
  IP:端口 + 「连接」；pairing 条目走配对表单）、配对码表单（host:port + 6 位码，小米
  系）、手动输入 `IP` + 端口缺省 5555（一等入口，荣耀系手机 tcpip 已开时直连）。
  **弹层打开即自动触发扫描**（不要求用户再点一次），弹层内留「刷新」按钮；
  `cross-subnet` 失败在此弹层内联提示。

### 4. 测试布局

- external 无线域：mdns 输出解析（含空格实例名、服务类型过滤、空输出）；网段探活
  （替身 prober、并发、超时）；connect 重试（offline → 1 次退避后 device；5 次耗尽
  → offline-race；timer 替身）；cross-subnet 分支（localSubnets 替身）；promote 链
  （ip route 解析、无 wlan0 报错、tcpip→connect 参数序列）；pair 成功/失败输出解析；
  disconnect 参数。
- renderer：连接器表单分支、扫描列表渲染、行卡按钮态、失败提示映射；组件测试对齐
  既有模式。

## 实施顺序（每步全绿门禁 + 独立 commit）

1. **S1 共享契约**：channels + types + 三语词条（纯新增）。
2. **S2 域函数**：external.ts 四函数 + 网段助手 + 测试（未接装配）。
3. **S3 装配**：ipc 通道 + preload api + index.d.ts。
4. **S4 renderer**：store 动作 → 行卡按钮 → 无线连接器（impeccable）。
5. **S5 验收 + 收尾**：清单过一遍（荣耀机当场可验；小米条目记 issue 留用户手动验收）；
   stage06 附结果行；learn/issue；`npm run book:index`。

## 验收清单

荣耀 30 Pro（当场可验，tcpip 已开通）：
- 插线 → 真机区 USB 行出「转为无线」→ 点击 → 成功提示 → 拔线 → 无线条目健在、投屏正常。
- 无线连接器手动输入 `192.168.31.102`（端口缺省）→ 连接成功、可投屏。
- 网段扫描列出该机（tcpip 已开的 5555 监听被发现）。
- 双条目并存：USB+无线同时在列，各开投屏可并行操控；拔 USB 后无线不受扰。
- 无线行「断开」→ 条目消失、投屏会话销毁。
- 手机重启后设备消失 → 再插线再点转无线可恢复（无持久化裁定下的预期行为）。
- `adb kill-server` 恢复回归（对齐第一批）。

小米系（**暂无设备——留用户手动验收，记 issue**）：
- 开发者选项开「无线调试」→ 扫描列表出 `_adb-tls-connect` 条目。
- 配对码表单 → pair 成功 → 扫描刷新 → 连接 → 投屏。

## 风险与兜底

- **adbd 重启竞态**：connect 重试 5 次退避（实测窗口数秒级）。
- **跨网段/TUN 劫持**：不做连通性魔法，cross-subnet 失败给一句话提示（同网段免疫已
  实测；提示文案教用户排查代理与 Wi-Fi 归属）。
- **mdns daemon 不可用**：源静默为空，手动输入兜底（一等入口）。
- **配对端口临时性**：配对码弹窗只在用户操作期间有效，UI 不缓存配对端口。
- **手机重启清 tcpip**：设备自然消失，重插线重转即可（无状态裁定的既定代价，不设
  引导态）。
- **荣耀系息屏深睡断 Wi-Fi（2026-10-15 凌晨实测）**：屏幕长灭后 Wi-Fi 整体挂起——ping
  全丢、ARP 仅残留、5555 不可达，无线条目过夜消失属**预期行为**；tcpip 模式本身仍在，
  唤醒手机（亮屏/充电）Wi-Fi 回来后 `adb connect` 即恢复，无需插线。缓解建议：引导
  用户睡觉时给手机插充电器（充电态荣耀不休眠 Wi-Fi）。
- **双 transport 并发建会话竞推 scrcpy-server**：同字节同路径并发 push 有极窄竞窗，
  最坏一个会话起失败、代次自愈；记 issue 不修。
