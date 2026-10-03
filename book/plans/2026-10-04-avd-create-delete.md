---
description: stage04 步骤 3 施工图——AVD 新建/删除接真：avdmanager 画像与 manifest 镜像清单（API × 变体 × arm64）、未装镜像向导内下载、create/delete + ANDROID_AVD_HOME 隔离
status: completed
created: 2026-10-04
---

# AVD 新建/删除接真 — plan

> 批准记录：2026-10-04 用户下令执行 stage04 前三步并编写开发计划（批准同 poc-gate plan，分支 `feature/stage04-emulator-integration`）。前置：PoC 过线、SDK bootstrap 可用。

## Requirements brief（Step 0）

**背景**：stage 03 的向导与设备域全程 mock（画像/镜像写死、create 只写元数据、delete 只删行）。本步接真：画像来自 `avdmanager list device`，镜像清单来自 Google 公开 repository manifest，未装镜像在向导内一键下载，create 真跑 `avdmanager create avd`、delete 真删 AVD 目录——全部隔离在应用自有目录（PRD F：对 Android Studio 隐身）。启动/停止仍不接（步骤 4 runner）。

**范围（影响什么）**：

- `src/main/emulator/avd.ts`：新建——create/delete AVD、画像清单
- `src/main/emulator/catalog.ts`：新建——镜像清单（manifest 拉取解析 + 已装状态探测）与镜像下载（sdkmanager 跑包 + 进度）
- `src/main/emulator/sdk.ts`：扩展最小接口供 avd/catalog 用（JAVA_HOME/sdkmanager 路径解析）
- `src/main/devices/index.ts`：create/delete 从纯元数据改为真建真删（守卫扩展）
- `src/shared/`：DeviceProfile/ImageEntry 类型 + `sdk:profiles` / `sdk:images` / `sdk:download-image` / `sdk:image-progress` 通道
- `src/preload/`：sdk 域白名单扩展
- `src/renderer/`：DeviceWizard 换真数据（画像列表、镜像列表含已装/待下载与进度、下载完成前禁创建）
- `book/stage/04` 步骤 3 勾选回写

**排除项（明确不影响）**：

- 不接启动/停止（步骤 4 runner：子进程池、端口避让、状态机、崩溃回写）
- 不做「创建中」设备行状态（本步 create 为同步等待的秒级操作，行状态机扩展属步骤 4）
- 不做持久化对账（stage 步骤 [suggested]，未经人批准不做）——stage 03 遗留的 mock 元数据行不迁移不清理，真实启动（步骤 4）前对账接管
- 运行中设备的删除仅做**拦截报错**（issue `2026-10-03-delete-running-device-no-stop` 的完整解法「先停再删」依赖 runner，属步骤 4）
- 不做镜像下载取消/排队（单下载互斥即可；需求只约束「下载完成前不能创建」）
- 不做克隆/复制/擦除 AVD
- 全新机器首启自动 bootstrap 的 UX（无 SDK 根时向导引导）顺延 stage 05——本步 SDK 未就绪时向导显示明确错误态

**边界**：镜像清单口径 = manifest `channel-0`（stable）× `arm64-v8a` × 三变体（aosp/google_apis/google_play），API 取近 5 个版本窗口（更老的折叠不列）；设备画像口径 = `avdmanager list device` 里**无 Tag 行**的定义（手机/平板；automotive/wear/tv/desktop/xr/ai-glasses 均带 Tag，实测过滤干净）；AVD 名 = 设备 id（uuid，文件名安全，重命名只改元数据不改 AVD 名）；目录 = `<userData>/avd-home/<id>.avd` + `<id>.ini`；零部分成功——create 先 AVD 后元数据，delete 先目录后元数据，任一步失败停在原地报错。

**learn/ 检索**：`2026-10-03-vitest-testing-library-gotchas`（向导组件测试沿用 Harness 惯例）；`2026-10-04-wizard-create-no-double-click-guard`（防连击三层已就位，保持）；`2026-10-01-dialog-unhandled-rejection`（toApiResult）。

## Impact range（Phase 1）

| 文件 | 动作 |
| --- | --- |
| src/shared/types.ts | DeviceProfile / ImageEntry / ImageInstallState |
| src/shared/ipc-channels.ts | `sdk:profiles` `sdk:images` `sdk:download-image` `sdk:image-progress` |
| src/main/emulator/avd.ts | 新建（create/delete/画像解析） |
| src/main/emulator/catalog.ts | 新建（manifest 清单 + 已装探测 + 镜像下载） |
| src/main/emulator/sdk.ts | 小扩展（路径/环境解析导出） |
| src/main/devices/index.ts | create/delete 接真 + 守卫扩展 |
| src/main/ipc/index.ts | 挂载新通道 |
| src/preload/api/sdk.ts、index.d.ts | 扩展 |
| src/renderer/src/components/DeviceWizard.tsx | mock 目录换真数据 + 下载态 |
| src/renderer/src/components/__tests__/DeviceWizard.test.tsx | 改造 |
| src/main/emulator/__tests__/{avd,catalog}.test.ts | 新建 |
| src/main/devices/__tests__/ | create/delete 守卫测试 |

**风险**：`avdmanager create avd` 的自定义硬件画像问句（stdin 喂 `no`，真实跑一次验证）；manifest 与变体目录名不一致（`aosp` 的目录/tag 是 `default`、`google_play` 是 `google_apis_playstore`——映射表单点收口）；sdkmanager 下载镜像 1.2–1.6GB 耗时无上限（进度可见即可，失败可整段重试）；jsdom 组件测试吃真实清单（清单拉取下沉到 store 注入，组件只吃 props）。

## Design（Phase 2）

**数据流**：

```
向导进入 → sdk:profiles（avdmanager list device 解析，进程内缓存 5 分钟）
         → sdk:images（3 份 manifest 并行拉取解析 + SDK 根已装探测；进程内缓存 60s）

选择未装镜像 → sdk:download-image
  main：许可检查（无 → 复用 bootstrap 的确认流程）→ spawn sdkmanager 装
       system-images;android-NN;<variantDir>;arm64-v8a
       stdout 百分比 → sdk:image-progress 推送 → 完成后失效镜像缓存

创建（第三步）→ devices:create（原通道，main 内部）
  守卫：镜像已装？名称合法？→ avdmanager create avd -n <id> -k <pkg> -d <profileId>
  （env：ANDROID_AVD_HOME/ANDROID_USER_HOME/ANDROID_EMULATOR_HOME/ANDROID_SDK_ROOT/JAVA_HOME
    全指应用自有目录）→ 成功后写元数据 → 落盘 → 广播 changed
  失败：无元数据落盘，错误文本回传

删除 → devices:delete
  守卫：status=running → 拒绝（报错文本明说先停止）
  → rm -rf <avdHome>/<id>.avd 与 <id>.ini（fs.rm force，缺文件视为成功）
  → 成功后删元数据 → 落盘 → 广播
```

**接口**：

- `listDeviceProfiles(runner)` → `DeviceProfile[] { id, name }`（解析完整格式输出，剔除带 Tag 定义）。
- `listImages()` → `ImageEntry[] { apiLevel, variant, abi: 'arm64-v8a', installed, sizeBytes, packageName }`；manifest 解析为纯函数吃 XML 字符串（单测喂 fixture）；`variant` 与目录/tag 的映射表：`aosp↔default`、`google_apis↔google_apis`、`google_play↔google_apis_playstore`。
- `downloadImage(entry, onProgress)` → sdkmanager 跑包；同一时刻仅允许一个下载（并发请求直接抛错）。
- `createAvd({ id, profileId, packageName }, dirs)` / `deleteAvd(id, dirs)`——`dirs` 为注入的目录三元组（avdHome/userHome/sdkRoot），纯逻辑与真实 spawn 分离便于单测。
- devices 域：`devices:create` 入参扩展可选 `imagePackageName`（缺省由 apiLevel×variant 反推），handler 校验镜像已装才放行。

**向导 UI**：第一步画像列表（名称，超长滚动）；第二步镜像列表按 API 降序 × 三变体，已装直接可选、未装显示「下载 x.x GB」（进度以百分比文本覆盖按钮，下载中不可切镜像）；镜像未装时第三步「创建」禁用；清单拉取失败显示错误态 + 重试。数据经 preload 拉取后放 wizard 本地 state（组件不吃全局 store）。

## Build order

1. shared 类型/通道 + preload 扩展——验证：typecheck 绿
2. catalog：manifest 拉取/解析（fixture 单测）+ 已装探测 + 映射表——验证：单测绿；真机拉真实 manifest 比对本机已装（android-36 三变体状态正确）
3. avd：画像解析（fixture 单测）+ create/delete 纯逻辑 + fake runner 单测——验证：单测绿
4. devices 域接真 + 守卫——验证：单测绿（fake runner）
5. 真机集成：用 bootstrap 产物 SDK 根 + 临时 AVD home 真建 `mst_it_<uuid>` → `avdmanager list avd` 见名 → 真删 → 目录消失；`~/.android` 无新文件（隔离判据）
6. 向导接真数据 + 下载流 + 组件测试改造——验证：组件测试绿；真机向导里真实下载一个未装镜像并创建成功
7. dev 冒烟（CDP）：向导全流程 + 删除拦截（running 行）+ 空态/错误态
8. Phase 5 review 只记录 → Phase 6 回写

## Test plan（Phase 4）

- 单测：manifest 解析（真实结构 fixture：channel 过滤、abi 过滤、size 字段、坏条目跳过）；画像解析（Tag 剔除、id/Name 提取、空输出）；create/delete 纯逻辑（成功/avdmanager 失败不写元数据/running 拦截/force 删除容忍缺 .ini）；devices 守卫（非法入参、镜像未装拒绝、名称非法）；向导组件（真数据 props 下的步进、下载态禁创建、错误态重试）
- 回归：既有 35+ 测试全绿不削断言；typecheck/lint/prettier
- 真机集成（Build order 5、6）：create/delete 全链路 + 隔离判据 + 向导真实下载创建

## Done criteria

真机全链路：向导选画像 × 未装镜像 → 下载（进度可见）→ 创建成功 → 设备行与 `avdmanager list avd` 一致 → 删除后目录消失、`~/.android` 零写入；删除运行中设备被拦截；既有 mock 行为（重命名/启停 mock 交互）不回归；单测/回归/typecheck/lint 全绿；review 发现只记 issue；stage/04 步骤 3 勾选附结果；`npm run book:index` 重刷。

> 完成记录（2026-10-04）：真机全链路通过。① 画像：avdmanager list device 不可用（issue 2026-10-04-avdmanager-sdk-root-null），改内置画像目录（9 个 Pixel 系手机/平板，含硬件参数，shared DeviceProfile 契约）——**对 plan 的设计偏差**，扩充/来源化留后续版本；② 镜像清单：3 份公开 manifest 直读（channel-0 × arm64-v8a，API 窗口 5，15 条），已装状态探测 SDK 根目录，60s 缓存；③ 镜像下载：sdkmanager 跑包 + 进度推送 + 单下载互斥 + 完成失效缓存，真机实测下载 android-33 AOSP 0.7GB → 已装标记正确；④ 创建：devices:create 守卫（未知画像/镜像未装/非法 payload 拒绝）→ 手写 .ini + config.ini（零部分成功：先 AVD 后元数据）→ 真机创建成功且 `emulator -list-avds` 认出、`~/.android` 零写入；⑤ 删除：运行中拒绝 + 真删 AVD 目录（force 容忍缺失）→ 元数据移除，真机验证目录消失；⑥ 向导：真数据三步流（含下载按钮/进度/错误态重试），CDP 驱动真实清单创建成功。109/109 测试绿（新增 22：catalog 解析与守卫回归（含 split 错位 bug 的回归锁）+ avd 创建删除 + devices 域接真 + 向导真数据改造），typecheck/lint/prettier 全绿。已知边界：SDK 未就绪时向导报错引导（全新机器自动 bootstrap 属 stage 05）；镜像下载取消未做（plan 排除项）；遗留 stage03 mock 元数据行（无真实 AVD）由对账步骤（stage [suggested]）接管。
