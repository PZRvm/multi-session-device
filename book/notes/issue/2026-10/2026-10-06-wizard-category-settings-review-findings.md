---
description: 向导分类与附加设置分支合并结果（feature/wizard-category-settings @220f298，含 image-uninstall 与独立窗两支并入）的总体 code review 发现——P1 能力构建双路径分叉致皮肤/摄像头选择创建必拒、P2 四项、P3 十二项
tags: [review, wizard, capabilities, skins, camera, race-condition, ipc]
---

# 向导分类与附加设置合并结果 review 发现（2026-10-06）

对 feature/wizard-category-settings（merge-base 7f79bb8，HEAD 220f298——已并入 wizard-independent-window 与 image-uninstall）的 Phase 5 式总体 review。范围 = 分叉以来全部源码变更（约 5–6 千行，XML fixture 为测试数据不在评审内）；历轮 review（卸载/下载取消/直连修复）的修复项已逐一核实**在位**，不再重复。基线：318 测试过（5 真机 smoke 跳过）、typecheck 0 错、lint 0 错 6 警告。

## P1 — 能力构建双路径分叉：皮肤/真实摄像头「UI 放行、创建必拒」

- **位置**：`src/main/emulator/settings.ts` 的 buildCapabilities（`skinIds`/`webcamDeviceIds` 恒空）↔ `src/main/emulator/index.ts` 的 sdk:wizard-capabilities handler（事后补齐两组枚举并解锁 skinRef 字段）↔ `src/main/devices/index.ts` 的 createDevice（只用裸 buildCapabilities 做归一化）＋ `src/renderer/src/components/wizard/SettingsForm.tsx` 的 cameraSelect（完全不读 `fields.frontCamera/rearCamera` 的 disabledReason）。
- **问题**：normalizeAdvancedSettings 按能力里的枚举校验 skinRef 与 webcam deviceId。向导侧能力来自 handler（枚举齐全、字段解锁），创建侧能力来自裸 buildCapabilities（两组枚举恒空）——同一份设置，本地校验通过、创建必拒。
- **复现（真机前提）**：① SDK emulator 包自带 `skins/` 且 layout 可解析 → 皮肤下拉可选、可导入（导入/下载钮不受 skinRef 字段禁用约束）→ 选任一皮肤 → 创建报「附加设置不合法（skinRef）：皮肤不在可用清单中」；② 带摄像头的 Mac 上 listWebcams 枚举非空 → 摄像头下拉出现「真实摄像头 webcam0」（无视「即将支持」禁用标记）→ 选它 → 创建报「前摄像头取值不合法」。两条出路都只剩重选画像/镜像触发能力重拉——且设置整体重置为默认。
- **影响**：真机常见环境下向导核心链路走到最后一步才失败；单测注入场景两边共用同一份能力对象，故全绿未暴露（集成级缺口）。
- **建议方向**：能力构建＋富化收敛为单一入口（createDevice 侧同样补 skinIds/webcamDeviceIds，或抽 buildEnrichedCapabilities 供两处共用）；cameraSelect 尊重字段 disabledReason。

## P2

1. **皮肤导入后 renderer 能力陈旧**（`DeviceWizard.tsx` importSkin/downloadSkinByName 成功即写 `advancedSettings.skinRef`；能力 effect 只依赖画像/镜像）。旧 skinIds 不含新导入皮肤 → 本地 settingsCheck 报字段错误、创建钮禁用。与 P1 相互独立——修 P1 后此路径仍卡本地校验。方向：导入成功后重拉能力，或本地把新皮肤即时并入校验上下文。
2. **创建×卸载 TOCTOU 残窗**（`devices/index.ts` createDevice：activePackageOp 检查只在入口做一次，其后 scanLocalImages + listDeviceProfiles 是秒级 Java 子进程 await 窗口；期间发起的卸载在引用查询里看不到尚未入列的 creating 行——临时行在 createAvd 之后才进 devices 数组）。可建出引用已删镜像的设备（启动失败、可删、不崩溃）。与 [image-uninstall review 跟进段](2026-10-06-image-uninstall-review-findings.md)「TOCTOU 窗口关闭」的记载不符，实为收窄。方向：创建事务全程持 packageOps（新增 create kind 或读锁语义），或更正该跟进段记载。
3. **sdk:wizard-capabilities 路径过重**：每次调用直跑 listDeviceProfiles（绕过 profilesCache）＋ scanLocalImages ＋ 双皮肤扫描 ＋ listWebcams 探针。配置页每次切换画像/镜像要 1–3 秒以上才解锁创建钮。方向：复用 profilesCache（指纹键已含失效语义）或按 capabilityContextId 记忆化。
4. **下载皮肤跨重启身份漂移**（`skins.ts` downloadSkin 落库 `downloaded:<id>`、name 为皮肤名；重启后仅被 scanImportedSkins 以 `imported:<id>` 扫回、name 变裸 uuid 前 8 位）。设备元数据里存的 skinRef 将匹配不到清单条目。当前皮肤显示未接线故未爆发；批次 7 收口前需统一落库形态或扫描时按来源目录区分。

## P3 清单

1. `settings-contract.ts` 存储换算检查 `storage % 1 !== 0` 是死代码（intIn 已保证整数）；plan「MB/GB 按 1024 换算不可表示的输入明确报错」在契约层无对应实现，注释误导。
2. `settingsToConfigPatch` 摄像头兜底 `deviceId ?? 'webcam0'` 与设计 7「不假定 webcam0 永远存在」相悖（归一化后不可达，但兜底值选错）。
3. `isNetworkPreset` 对 netspeed/netdelay 用两表并集校验——伪造 `-netspeed none` 可过 main 复核（emulator 会拒，失败可见）；字段禁用态同样不在 main 复核范围（wear/tv 提交 orientation 会写入 config）。
4. `patchAvdConfig` 注释称「同键多行时以最后一处为准并只重写该处」，实现是重写首处、保留后续重复键——Java properties 末次优先语义下 patch 会被旧值盖掉（avdmanager 不产重复键，纯边缘）。
5. `installImageZip` 回滚失败静默吞（恢复备份的 moveDir `.catch(() => undefined)`）且报错文案宣称「已回滚」——设备创建事务有「回滚失败回报残留路径」标准，镜像安装域未对齐（备份留 `.install-bak`，扫描免疫、可手工恢复）。
6. RAM 默认地板 2048MiB 对所有形态生效——wear 等小内存画像被抬到 2GB（「Android Q+ 镜像 2GB」是否适用 wear 镜像未核实）。
7. 「显示弃用画像」开关是死 UI（deprecated 恒 false——types 注释已声明无信号源，但开关随产品发布）。
8. `DeviceWizard.tsx` 模块级可变量 lastActiveDownload/lastActiveUninstall（向导单例下可接受，测试隔离需注意）；lint 6 警告待清：exhaustive-deps ×2（277 行 reloadSkins 缺依赖且无注释说明；422 行有注释说明属有意）、unused eslint-disable ×3、测试文件 prettier ×1。
9. `cameras.ts` listWebcams 无超时——emulator 探针挂死则该次能力 invoke 永不返回，UI 无重试入口。
10. `importSkinArchive` 未实现 plan 设计 6 的「限制资源数量/体积」；逃逸核验为词法 resolve ＋ 禁 `..`（plan 措辞是 realpath；adm-zip 不产符号链接故等效，但记载与实现不符）。
11. 镜像下载完成路径双拉清单（invoke resolve 后 reloadImages 与 100% 广播各一次；第二次命中 60s 缓存，开销可忽略——与卸载侧二轮修复的「双拉去重」口径不一致，记录在案）。
12. `devices/index.ts` skinDirectoryFor 两分支恒返回 join 结果、调用处的 null 判断是死代码；皮肤目录无二次逃逸校验（当前经 skinIds 白名单间接保护，P1 修复开放枚举后建议补 realpath 归一）。

## 复核确认无问题项

- 历轮修复全部在位：packageOps 双向互斥、取消幂等 ＋ done 显式收尾信号、卸载终态广播在落盘复核 ＋ 缓存失效之后、写流错误常驻监听与背压竞争、sha1 前检查点并入清理域、扫描点前缀过滤、自生成 package.xml 元素序对齐官方 XSD、卸载 executor 的 stdout 收集 ＋ 180s 有界超时。
- downloader 落位事务（备份/落位/三件套核验/回滚）与临时物点前缀纪律完整；store v2 显式双版本读取 ＋ 写保护 ＋ v1 一次性备份 ＋ commitMetas 全局串行且写盘成功才换内存；packageName 单一身份贯穿清单/下载/创建/落盘；兼容性判定 shared 单源、UI 与 main 同函数；IPC 面 sender 三档白名单（main/create/wizard）与通道名单源对齐；皮肤导入逃逸核验（禁 `..` ＋ entries.includes ＋ resolve 前缀）实际有效。

## 合并融合补充（2026-10-06，集成分支并入 a48ab0d）

- **P3 — JAR-only 外观索引对 wear/tv 误判 phone**：融合后的 `loadFrameKindIndex`（`classifyFormFactor` 薄包装）只读 sdklib JAR 的裸 XML 元数据，而 wear/tv 的形态 tag 只在 avdmanager 输出侧（见 `mergeProfiles` 注释「tag 互补」）——`wearos_large_round` 按屏幕尺寸规则判成 `phone`，投屏将套手机壳。frameKind 仅为显示提示（不入盘、不影响创建/运行语义），富分类管道（listDeviceProfiles 的 tag 合并）不受影响；待外框支持更多形态或索引接富分类时修正。单测已按实际行为断言并注明局限。
- 融合过程另修复两处自动合并暗坑：devices 测试的 `vi.mock('../../emulator/profileMetadata')` 被并成两份（后份覆盖前份会丢 `sdklibJarPathFor` mock）——合并为单一 factory；`book/README.md` 索引冲突按生成物再生成解决（122 篇）。

### 跟进（同日修复轮）

- **P3 已修**：`readJarProfileMetas` 读取层按源文件补隐含形态 tag（新增 `withImpliedFormTag` 纯函数——fixture 实证七份 XML 零 tag 元素、avdmanager 的 Tag 按源文件归类：wear.xml→android-wear，tv/desktop/automotive/xr 同理）。纯 JAR 消费方（外观索引）与 avdmanager 合并管道分类就此一致：wearos_large_round 等非手机/平板形态 → generic 兜底，不再按屏幕尺寸误判 phone；mergeProfiles 的 tag 并集天然去重，向导管道行为不变（XML-only 画像的无 avd 条目分类也随之修正）。测试 +2（隐含 tag 纯函数四断言、索引 wear/tv→generic），全套 362 过。

### 修复轮 review（2026-10-06，d612c8d..9497b75）

Phase 5 检查单八项过了一遍，一项 P3：

1. **P3 — 形态登记两处维护**：`DEVICE_XML_ENTRIES` 与 `FILE_IMPLIED_FORM_TAGS` 并列——未来 cmdline-tools 新增形态专属 XML（或调整归类）需同步改两处，漏登则该形态静默回落屏幕尺寸规则。建议后续合并为单表（name + impliedTag 一体登记）。

**跟进（同日）**：P3 已修——两表合并为 `DEVICE_XML_SOURCES` 单表（name + impliedFormTag 一体登记，通用文件显式 null），读取清单与隐含 tag 同表派生；`withImpliedFormTag` 对未登记名原样返回（新增防御）。定向测试 62 过、typecheck/lint 0 错。

复核确认无问题项：ai-glasses 画像与 xr 同在 xr.xml（fixture 实证），补 android-xr 后索引判 unknown→generic——同类误判一并消除，无残留；`withImpliedFormTag` 纯函数不改入参、未知文件名原样返回、重复 tag 不叠加均有断言；测试 fixture `jarMetas` 为生产组合的镜像（parseDeviceXml ＋ withImpliedFormTag）已注明；无重复代码/竞态/越范围改动；修复后全套 362 过、typecheck/lint 0 错。
