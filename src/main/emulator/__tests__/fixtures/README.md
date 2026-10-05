# 真实环境 fixture（批次 1 探索产物）

来源：本机 `~/Library/Android/sdk`（cmdline-tools `latest`，emulator 36.1.9.0，build 13823996），2026-10-05 提取。
用途：画像/镜像/设置模块的解析与守卫测试，替代手写假样本。字段含义以这些真实文件为准。

## devices-xml/ — 官方画像元数据

来自 `cmdline-tools/latest/lib/sdklib/sdklib.core.jar` 内 `com/android/sdklib/devices/*.xml`（`tools.sdklib.jar` 内为同一份）。avdmanager list device 的 96 个定义由这组文件 + avdmanager 自身展开构成。

| 文件 | 设备数 | namespace 版本 |
| --- | --- | --- |
| automotive.xml | 8 | devices/8 |
| desktop.xml | 4 | devices/1 |
| devices.xml（通用：Resizable/Freeform/Foldable 等） | 5 | devices/7 |
| nexus.xml（Nexus/Pixel 手机与平板） | 25 | devices/9 |
| tv.xml | 3 | devices/1 |
| wear.xml | 3 | devices/7 |
| xr.xml | 4 | devices/10 |

结论：解析必须按 localName 匹配、容忍 namespace 版本 1–10 差异；类别信息主要来自文件归属（wear/tv/desktop/automotive 文件）+ `<d:tag>`（车载 Play 标签等），手机/平板靠屏幕尺寸区分。

## system-images/ — 精确包身份

- `android-36.1-playstore-package.xml`：API 小版本样本。`<api-level>` 是字符串 `36.1`（非整数）；`localPackage` 的 `path` 即完整包名 `system-images;android-36.1;google_apis_playstore;arm64-v8a`。
- `android-36.1-playstore-source.properties`：含 `AndroidVersion.ExtensionLevel=20`、`AndroidVersion.IsBaseSdk`、`Pkg.Dependencies=emulator#35.4.9`（最低 emulator 版本）、`SystemImage.TagId/TagDisplay`、`SystemImage.GpuSupport`。安装核验按这些键对账。
- 本机另有 `android-36/google_apis_ps16k`（16KB 页样本）与 `android-36/google_apis`，同结构。

## skins/ — 皮肤布局语法

`pixel_7-layout`：Android Emulator 皮肤 layout 的嵌套块语法。`parts.device.display` 定义屏幕（width/height/x/y），`parts.portrait.background/foreground` 定义外框素材与 cutout；`layouts.portrait` 给出整框尺寸与部件摆位。SDK `skins/` 目录自带 30+ 皮肤（pixel 全系、nexus 全系、automotive 三种），即「SDK 已安装皮肤」来源；独立可下载源的许可核实推迟到皮肤批次。

## 本机能力枚举（emulator 36.1.9 `-help-*` 实测）

- `-gpu`：`auto` / `auto-no-window` / `host` / `swiftshader_indirect` / `angle_indirect` / `guest`（无 `host_indirect`）。
- `-netspeed`：`gsm` / `hscsd` / `gprs` / `umts` / `edge` / `hsdpa` / `lte` / `evdo` / `5g` / `full` + `<num>` / `<up>:<down>`。
- `-netdelay`：`gsm` / `hscsd` / `gprs` / `umts` / `edge` / `hsdpa` / `lte` / `evdo` / `5g` / `none` + `<num>` / `<min>:<max>`。
- 摄像头枚举入口：`emulator -avd <任意名> -webcam-list`，输出 `webcam0/webcam1…` 及设备 UUID；实际取流权限归 emulator/QEMU 进程（macOS TCC）。
- config 键白名单（hw.cpu.ncore / hw.ramSize / vm.heapSize / hw.gpu.mode / hw.initialOrientation / hw.camera.front|back / disk.dataPartition.size / skin.*）以所装 emulator schema 为准，接入前在 settings 模块锁成可测常量。

## 系统镜像 zip 布局（2026-10-06 真机实证，arm64-v8a-21_r04.zip）

- 首层是 `<abi>/`（如 `arm64-v8a/system.img`），**不带** `<platform>/<tag>/` 层——落位路径由包名推导（sdkmanager 同语义）。
- zip **不含 package.xml**（sdkmanager 从 repo 元数据生成）；含 source.properties。
- `userdata.img` 解压后恰为 2147483648 字节（2^31）——adm-zip 单条目 Buffer 分配撞 Node 上限直接崩，镜像解压必须走系统 `unzip`（zip64 支持）。
- manifest `archives.complete` 含 size/sha1/相对 url（基址 `sys-img/<源>/`）；绝对 URL 实测 200 且 `accept-ranges: bytes`。
