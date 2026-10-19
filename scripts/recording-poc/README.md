# Recording validation

独立媒体能力验证，不接产品按钮，不修改 SDK/已有 AVD，不把临时媒体提交进 Git。
结果与边界见 `book/docs/poc/2026-10-16-recording-p0.md`。

## 依赖与输出

- 仓库 `npm ci` 安装的 Electron、esbuild 与 Tango。
- 在隔离目录安装 `mediabunny@1.61.5`，不改产品 package.json/lock：

```sh
npm install --prefix .codex/recording-poc/runtime --no-audit --no-fund --save-exact mediabunny@1.61.5
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/recording-poc/bootstrap.cjs
```

默认输出 `.codex/recording-poc/`（Git 忽略）。原始捕获、合成视频、能力 JSON、播放器检查都留在这里。
`MSD_RECORDING_POC_ROOT` 可指定独立输出目录；其中需提供 `runtime` 或指定媒体库位置。
`MSD_RECORDING_POC_RUNTIME` 指隔离 npm 目录；`MSD_RECORDING_POC_MODULE` 可指定被测库 ESM 入口。
bootstrap 在 ready 之前隔离 userData，避免与用户正常应用共用配置。

## 可控设备源

`fixture/` 是专门的 Android 测试程序：动态画面、20 秒轮换横竖屏、白色闪光与 1kHz 短音。
闪光按 AudioTrack 的播放时间戳驱动，不按写入 PCM 的时刻推断实际出声时间。
它不读取麦克风、账号或媒体文件。只安装到明确指定的测试设备。

```sh
node scripts/recording-poc/build-fixture.mjs
adb -s <test-serial> install -r .codex/recording-poc/fixture/fixture.apk
adb -s <test-serial> shell am start -n com.foreunit.recordingpoc/.MainActivity
```

构建使用已有 Android SDK 36.1.0 build-tools、android-36/android.jar 和 Studio JBR，可通过 `MSD_POC_SDK`、`MSD_POC_JAVA` 覆盖。测试密钥仅在忽略目录生成，不可用于产品签名。

临时 AVD 放在独立 `ANDROID_AVD_HOME`，选空闲端口，以 `-no-window -no-snapshot -gpu host` 启动；不要启动/覆盖用户 AVD 或占用已在用的 serial。首次验证使用 API 36 google_apis arm64、1080×2400、RAM 2048MiB，两个临时实例分别为 emulator-5580/5582。

## 捕获与测量

```sh
MSD_POC_SERIALS=emulator-5580,emulator-5582 MSD_POC_DURATION_MS=620000 node scripts/recording-poc/capture.mjs
MSD_POC_MUX_SERIAL=emulator-5580 node scripts/recording-poc/mux.mjs
env -u ELECTRON_RUN_AS_NODE MSD_POC_PROCESS=1 node_modules/.bin/electron scripts/recording-poc/bootstrap.cjs
env -u ELECTRON_RUN_AS_NODE MSD_POC_PLAYBACK=1 node_modules/.bin/electron scripts/recording-poc/bootstrap.cjs
```

capture 复用现有 transport，另建独立 scid/独立 jar 的 audio-only AAC playback/dup 会话，记录原始二进制包、PTS、宿主单调时钟与统计，不录宿主声音。SIGINT/SIGTERM 结束采集并清理自己的会话。输出包格式：32 字节头（配置标记/关键帧/PTS/长度/收包单调时钟）+ 原始 payload。

process 只处理指定的三个有效区间（10 秒、跳过 2 秒、13 秒、跳过 4 秒、16 秒），按关键帧裁剪和共同时间轴生成最大宽高画布；不是正式任务管理器。`MSD_POC_FROM_SECONDS=300` 或 `570` 检查中/末段；`MSD_POC_MUX_SERIAL` 切测试实例。

`MSD_POC_AUDIO_CLOCK=samples` 是**候选音频时钟修订**：保留首个音频 PTS 与视频的起点关系，后续按 AAC 采样数推进，而非用收包时间或强制减去固定偏移。输出名加 `-samples`。它在当前 AVD 样本通过，不代表已获真实设备的通用性验证，不得在报告中混淆两组结果。

```sh
node scripts/recording-poc/measure-sync.mjs <fixture-video.mp4> <measurement.json>
```

测量使用本机已有 ffmpeg/ffprobe 作独立测试仪器；应用实现不依赖 FFmpeg。脚本只适用于本测试源，通过中心闪光和音频脉冲的最近事件差比较，阈值 100ms；至少三个事件，不把无事件判为通过。不覆盖真实应用的任意内容同步。

静止测试：停止测试 fixture 后，用独立输出目录采集；`MSD_POC_RESET_VIDEO=1` 在音频就绪后请求新关键帧；`MSD_POC_STATIC_TAIL=1` 的 mux 按停止单调时钟补静止尾帧，不将最后帧 PTS 当实际停止时刻。

`physical.mjs` 只短暂建立视频源，检查配置与关键帧，不持久化屏幕像素、不安装 fixture；必须显式设置 `MSD_POC_PHYSICAL_SERIALS`。当前 API 31 设备只能证明 USB/无线视频与音频能力降级判定，不能冒充 Android 13+ 音频验证。

## 清理

停止自己启动的临时 AVD，移除自己的残留 forward（按记录的 serial + tcp 端口逐条移除），不使用 kill-server / remove-all。不删除用户 Downloads；调查失败时保留 bin/JSON 供重放。包、测试证书与 AVD 状态均在忽略目录，按需要精确清理。

## 正式录制链路探针

`product-integration.mjs` 调用正式 scrcpy/RecordingManager/IPC/处理页及构建 UI；只用隔离的两台测试 AVD，设备列表元数据由探针提供，不触碰用户设备库。`build-product.mjs` 用现有 esbuild 打包探针，生成独立 package.json 与资源软链，所有产物都在忽略目录。

```sh
npm run build
node scripts/recording-poc/build-product.mjs
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS MSD_PRODUCT_PROJECT="$PWD" MSD_PRODUCT_ROOT="$PWD/.codex/recording-poc/product-run" MSD_PRODUCT_DURATION=620000 node_modules/.bin/electron .codex/recording-poc
```

探针包含两设备独立文件、A 暂停/继续、主窗销毁重开、宽窄窗口捕获。测试 hook 在生成前复制封存原始包到 root/raw，正式产品不保留成功任务原始包。`MSD_PRODUCT_REGENERATE=<raw 目录>` 可在独立 profile 中恢复并重新生成，验证生产重试和打包路径。`MSD_PRODUCT_TOUCH=1` 是实验性合成 PointerEvent 延迟探针；曾出现超时/基线异常，不能据此宣称触控预算通过。

打包测试先以 `MSD_PACKAGED_CHECK=1 node scripts/recording-poc/build-product.mjs` 生成临时 out/main/recording-integration.cjs，再用独立 appId/productName、该测试入口与隔离输出打包。它验证实际 asar 里的依赖/处理页/preload 与文件生成，不替代正式入口、退出及真实硬件验收；再次 npm run build 会清掉临时入口。

`MSD_POC_PLAYBACK_FILE` 可为 playback 探针指定真实成片。同步仪器按 ffprobe 的解码帧 PTS/样本数定位音频事件，保留初始偏移和合法间隙，排除停止边界裁断且没有完整配对上下文的事件；100ms 阈值与至少三个事件的要求不变。

## 当前边界

旧的 capture/mux/process 等脚本仍是 P0 工具，不等于产品任务。正式链路已有代码，真机音频、完整性能及其他硬件验收见 plan 的未验项，不因探针成功提前标整项交付。
