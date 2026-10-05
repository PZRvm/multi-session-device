---
description: 修复镜像下载进度恒 0%——实测确认官方 CLI 两代都无可读进度流（管道全缓冲 + 新版无进度行），改为 manifest 直连流式下载自算真实进度
status: completed
created: 2026-10-06
---

# 镜像下载进度修复（manifest 直连） — plan

> 实现记录（2026-10-06，fix/download-progress-zero）：按 Build order 全部完成。`catalog.ts` 透出 `zipUrl/zipSha1`（`archives.complete` 的 url/checksum，绝对地址在 fetchImageCatalog 按源拼接）；新增 `downloader.ts`（流式下载真实百分比、字节封顶 99%、100% 留给全链路成功；sha1 必校验；系统 unzip 解压；**package.xml 由 manifest 元数据生成**——zip 不带；落位 rename + .bak 回滚）。真机验收（android-21，202MB）：50MB Range 流进度采样 50 个样本 1%→99% 连续；完整链路解压含 2147483648 字节 userdata.img、生成 package.xml、三件套+身份核验通过、自装包被 `scanLocalImages` 识别为 verified；sha1 不符拒绝+清理路径真机实证。真机验收另抓到两个实现级坑（adm-zip 单条目 Buffer 撞 2^31 上限→系统 unzip；zip 首层是 `<abi>/` 非 `<platform>/<tag>/<abi>/`→布局探测泛化），记入 learn。单测 10 新增、全套 285 过；typecheck/lint 0 错。互斥/失败广播/重开恢复（activeDownload）回归保持。Phase 5 review 为事后补做（流程遗漏在案）：发现 P1 写流错误未监听可致 main 崩溃、P2 .install-bak 可被扫描误读、P2 package.xml 元素顺序与 XSD sequence 不一致——见 issue 2026-10-06-download-direct-review-findings，按纪律只记录未修。

> 用户报告：下载镜像时进度永远 0%，下载完成后直接跳「已完成」。要求先排查、单独成计划。本 plan 基于本机实测（2026-10-06，cmdline-tools `latest`（sdkmanager 已被标记 deprecate，替代为 `android` CLI）、emulator 36.1.9、macOS arm64）。

## 排查结论（实测证据）

现状链路：`runSdkManagerPackages` spawn `sdkmanager --install`，stdout 按 `\r`/`\n` 分段后用 `parseSdkManagerPercent` 抓 `NN%`，喂给 `onPercent` → `sdk:image-progress` → 向导。

实测三个事实：

1. **管道模式下 stdout 全程零 chunk**。spawn（stdio pipe，非 TTY）安装 `platforms;android-35`（60MB），整个安装过程 `child.stdout` 的 data 事件次数 = 0（仅 stderr 有 deprecation 警告）。Java 在非 TTY 下 stdout 全缓冲，进度行攒在 Java 进程内不 flush，进程退出也未送达。UI 显示的 0% 是 renderer 侧 `setDownloading({percent: 0})` 的初始值——main 从未推送过任何中间百分比。
2. **PTY 包装能拿到输出，但新版 CLI 根本不打印百分比**。用 macOS 自带 `script -q /dev/null` 包进伪终端后输出实时到达，但内容只有：仓库 URL 行（`https://dl.google.com/.../platform-35_r02.zip...`）与 `Unzipping platforms/android-35......`——旧版 sdkmanager 的 `[====] 45%` 进度条在新 cmdline-tools 非交互模式下已不存在。即缓冲问题之上，还有「无进度行可解析」这一层。
3. **替代 CLI `android sdk install -v` 完全静默**（exit 0、stdout/stderr 0 字节，包安装成功）。也没有机器可读进度。

临时文件旁路（监听 SDK 根/系统临时目录的增长文件）在 60MB 样本上未能捕获稳定可观测路径（小包数秒完成，lsof 未及采样）；即使可行也依赖实现细节，不作首选。

结论：**官方 CLI 无进度流可用，任何「解析 sdkmanager 输出」的路线都到不了真实百分比**。修复必须换数据源——我们已有的 manifest（批次 3 六源结构化解析）里每个包的 `archives.complete` 节点带 zip URL、字节数与校验值，直接流式下载即可得到真实、准确、可校验的进度。

manifest 字段实证（google_apis_playstore 源 android-36.1 条目）：`<complete>` 含 `size=1958370801`、`checksum type="sha1"`、`url=arm64-v8a-36.1_r04.zip`（相对路径，基址 `https://dl.google.com/android/repository/sys-img/<源目录>/`）；拼接后的绝对 URL 实测 HTTP 200 且 `accept-ranges: bytes`（支持断点续传，本期不启用）。

## Requirements brief

- 作用域：`sdk:download-image` 链路的下载执行体（spawn sdkmanager → manifest 直连流式下载）；进度语义不变（`sdk:image-progress` 百分比）；下载完成后的安装核验与缓存失效逻辑保持。
- 排除项：bootstrap（JRE/cmdline-tools 下载已是自管流式，不受影响）；皮肤下载（独立链路）；下载取消/断点续传（本期不做，失败重下）；licenses 确认流程不变。
- 边界：仅 arm64 包可下载（守卫已有）；下载互斥、失败广播、向导重开恢复（`activeDownload`）等既有行为全部保持；`sdkmanager` 仍是安装核验与目录布局的参照（解压落位后按三件套核验）。

验收要求：下载 60MB+ 镜像时向导进度百分比持续增长（采样间隔可见变化）；完成前百分比 < 100，核验通过后才显示已安装；下载中重开向导仍能恢复进度；校验失败给出中文错误且不留半安装目录。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/main/emulator/catalog.ts` | `RawRemotePackage` 补 `zipUrl`/`sha1`/`zipSizeBytes`（manifest `archives.archive.complete` 的 url/checksum/size，`ImageEntry` 同步透出） |
| 新增 `src/main/emulator/downloader.ts` | 流式下载：fetch zip → 按 `Content-Length`/manifest size 算百分比 → sha1 校验 → 解压落位 `system-images/<平台>/<tag>/<abi>/` → 三件套核验；接缝注入（fetcher/解压器/文件系统）供单测 |
| `src/main/emulator/index.ts` | `sdk:download-image` 执行体换 downloader；互斥/进度推送/失败广播/缓存失效不动 |
| `src/main/emulator/sdk.ts` | `runSdkManagerPackages` 保留（bootstrap 等场景仍用），不再服务镜像下载 |
| `src/main/emulator/__tests__/downloader.test.ts`（新）+ `catalog.test.ts` | manifest 字段透出；进度计算；校验失败拒绝；解压后核验；半安装清理 |

风险：zip 内部布局与 SDK 目录映射（sys-img zip 解开即 `android-36/<tag>/<abi>/` 完整目录，含 `package.xml`/`source.properties`——需以真实 zip 样本验证一次并落 fixture 记录）；`Content-Length` 与 manifest size 不一致时以实际流为准报歧义；与 sdkmanager 装好的目录混存时核验口径不变（三件套）。

## Design

1. **manifest 透出**：`parseSysImgManifest` 已读 `archives.archive.complete` 的 `size`；补读同节点的 `url`（相对 `https://dl.google.com/android/repository/` 拼绝对地址）与 `checksum`（sha1）。`ImageEntry` 加 `zipUrl: string | null`、`zipSha1: string | null`（local-only 条目为 null）。
2. **下载执行体**（`downloader.ts`）：
   - 下载守卫前置：包必须在可信目录、arm64、`zipUrl` 非空（无 URL 的条目报「该包不支持应用内下载」而不是退化）。
   - 流式 fetch：按接收字节数 ÷ manifest size 推 `onPercent`（节流 ≥1% 或 ≥500ms 一次，避免每 chunk 刷 IPC）；流写入 `.tmp`（目标目录旁）。
   - 校验：sha1 与 manifest `checksum` 比对（有值必校验）；不匹配删除临时文件报中文错误。
   - 解压落位：zip 内首层即包目录树，解压到 `system-images/` 下合并；解压完成做三件套核验（package.xml + source.properties + system.img），不过则整体回滚本次目录并报「安装核验失败」。
   - 互斥/取消语义：沿用 main 侧 `downloading` 对象与「不宣称取消」口径；本期无断点续传，失败重下从 0 开始。
3. **接线**：`sdk:download-image` handler 内把 `runSdkManagerPackages(root, [pkg], cb)` 换成 `downloadImagePackage(root, entry, cb)`；进度回调、失败广播、`imagesCache` 失效、finally 清互斥全部不动。
4. **留档**：真实 zip 样本（小包）的 manifest 节点与目录布局截图/记录入 fixtures README；sdkmanager 路线退役原因（本文排查结论）在 `sdk.ts` 注释留一句指向本 plan。

## Build order

1. manifest url/checksum 透出 + `ImageEntry` 字段。验证：真实 fixture（六源）里 36/36.1/ps16k 条目都有 zipUrl 与 sha1；单测覆盖缺字段子集。
2. `downloader.ts` 下载/校验/解压/核验/回滚 + 注入接缝单测（模拟流、坏 sha1、缺 system.img、解压失败）。
3. handler 换执行体；互斥/广播/恢复回归（既有用例改桩）。验证：mock 流式分块 → 百分比单调递增推送；失败广播仍带 error 字段。
4. 真机验收：下载一个未装 arm64 镜像（60MB+），录得进度连续增长；完成后向导核验已装、可创建；人为坏包（改 sha1）验证拒绝与无残留。
5. Phase 5 review 记录、Phase 6 book 同步（learn 记「官方 CLI 无进度流」实证）。

## Test plan

- 单测：manifest 透出（六源样本）；百分比计算（含 Content-Length 缺失回退 manifest size）；sha1 不符拒绝且清理；三件套缺件回滚；进度节流。
- 既有回归：下载互斥、失败广播、重开恢复（activeDownload）、下载完成后清单重拉与创建解锁全部保持。
- 真机：进度连续性 + 真实安装核验 + 创建链路走通（avdmanager -k 用直连装好的包）。

## Done criteria

- 真实下载进度连续可观测（非 0% 跳变）；校验与核验拒绝路径有中文反馈且无半安装残留；既有下载域回归全绿；`sdkmanager` 输出解析不再承担镜像下载进度（代码注释指向本 plan）；book 同步完成。
