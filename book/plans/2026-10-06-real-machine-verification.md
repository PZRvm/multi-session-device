---
description: 修复轮真机验证三件（皮肤/摄像头创建链路、能力加载时延、解压取消）与六类画像真机验收的前三阶段设计——Step 0 简报、Phase 1 影响图与风险、Phase 2 验证矩阵与证据契约
status: in-progress
created: 2026-10-06
---

> **2026-10-08 核对**：阶段 4 基础交付合入 dev，本 plan 的八项完整证据仍未齐，保持 in-progress。皮肤/摄像头后续实现见 [集成 plan](2026-10-07-skin-camera-integration.md)；其中已证实本应用身份下摄像头枚举可用，macOS 权限由应用身份与取流责任链共同决定。下文将授权仅归 emulator、首次启动必弹窗的说法保留为当时待验证假设，不作为当前事实；后续同意/拒绝和签名版路径应从现有应用权限入口实测。未验项目见 [当前遗留](../notes/issue/2026-10/2026-10-06-wizard-plan-remaining-acceptance.md)。

# 真机验证与六类验收 — plan（Step 0–2 设计稿）

依据：[向导 plan 修复轮进度段](2026-10-05-emulator-wizard.md)（真机三件未验）、[验收遗留 issue](../notes/issue/2026-10/2026-10-06-wizard-plan-remaining-acceptance.md) 第 4 条、[review-findings 全量修复轮段](../notes/issue/2026-10/2026-10-06-wizard-category-settings-review-findings.md)（P1/P2-3 修复未经真机）。本 plan 只做验证与记录，**不改产品代码**；验收中暴露的代码缺口记 issue 另行立项。

## Requirements brief（Step 0）

**背景**：向导重构与 review 全量修复已过全部自动化关卡（377 测试 / typecheck / lint 0-0），但两块只有真机能关：修复轮三项修复的实际效果、六类形态的端到端可用性。用户已确认这是下个真机窗口的全部工作。

**本期范围**：

- 工作流 A（修复轮验证，约 40 分钟）：①P1——选 SDK 皮肤与「真实摄像头」后创建必须成功且配置落位；②P2-3——能力加载时延达标；③download-cancel 尾巴——解压瞬间取消干净可重下。
- 工作流 B（六类验收，约 2–3 小时含下载）：phone/tablet/wear/tv/automotive 五类逐类「画像 → 镜像 → 创建 → 启动 → 投屏 → 输入 → 停删」，desktop 验证「如实不可用」。附 wear 表头修复（52d7bca）回归确认。

**明确不影响（排除槽）**：

- Quick Boot 稳定性门槛（连续 10 次 + 双机各 5 次）——独立门槛，不并入本 plan；
- 机型皮肤投屏显示接线（等通用外框几何依赖的后续批次）——本 plan 只验 config 落位；
- 皮肤独立下载源核实、SD 卡、跨架构——与 [验收遗留 issue](../notes/issue/2026-10/2026-10-06-wizard-plan-remaining-acceptance.md) 边界一致；
- 不修任何验收中发现的代码问题——只记录进 issue。

**边界**：本机 macOS Apple Silicon + arm64；测试用新建 AVD，不动用户已有设备与 SDK 已装组件；判据线沿用 stage04（投屏 ≥30fps、触摸 ≤150ms 参考 PoC 中位 75ms）。

## Phase 1 分析

### 影响图

```
真机窗口
├─ 工作流 A：修复轮验证（只读验证 + 新建测试 AVD）
│  ├─ A1 创建链路 → sdk:wizard-capabilities / devices:create / avd patchAvdConfig
│  ├─ A2 能力时延 → profilesCache(5min) / listWebcams 探针(≤10s 超时)
│  └─ A3 解压取消 → downloader AbortSignal / unzip kill / tmp 清理
└─ 工作流 B：六类验收（每类一台新 AVD，验收后删）
   ├─ 数据流：官方 manifest 六源 → 向导目录 → 下载(未装) → 创建 → runner → scrcpy 投屏/输入
   ├─ 输入面：画布键盘白名单（arrow×4 + enter 已在）→ TV D-pad 预计可覆盖，验收确认
   └─ 产出回写：plan 进度段 / 验收遗留 issue / 新 issue（若有缺口）/ learn（若有坑）
```

### 风险清单

1. **tv/wear 输入缺口**：方向键与 enter 已在画布键盘白名单（`ScreenKeycodeName`），预计覆盖 TV 最小操控；若实机不可操控 → 记 issue（补映射是新代码任务，不在本 plan）。
2. **wear 圆屏几何**：等比画布不裁切已过 phone 真机，圆屏未验——比例拉伸/黑边风险，证据必留截图。
3. **下载耗时与磁盘**：未装类别按需下载（0.6–1.5GB/类，zip+解压双倍占用）；本机余 243Gi 充足，验收前清点已装避免重复下载。
4. **真摄像头 TCC 授权**：取流授权归 emulator 进程（非本应用）——首次启动弹系统授权窗，同意与拒绝两条路径都要走（plan 设计 7 原文）。
5. **A3 解压窗口秒级**：点取消要准，预计需 2–3 次尝试，记录每次实际命中的阶段（下载尾段 vs 解压段）。
6. **automotive playstore 变体**：许可与兼容未实测，`android-automotive` 与 `-playstore` 任选其一，装不上换变体并在证据中注明。
7. **desktop 无官方镜像源**：验收结论预期为「不可创建 + 中文原因」——验证的是展示诚实，不是创建成功。

## Phase 2 设计

### A. 修复轮验证（三项）

**A1 创建链路（P1）**——操作 → 观察点 → 证据：

1. 向导选 phone 画像（如 Pixel 7）+ 已装镜像 → 附加设置「机型皮肤」选 `sdk:pixel_7` → 创建。
   - 观察：创建成功零弹错（修复前必弹「附加设置不合法（skinRef）」）。
   - 证据：设置页截图 + `~/Library/Application Support/multi-session-device/avd-home/<uuid>.avd/config.ini` 片段——断言 `skin.name=pixel_7` 存在。
2. 再建一台，摄像头前后任选「真实摄像头 webcam0」→ 创建。
   - 观察：成功；config.ini 断言 `hw.camera.front`（或 back）`== webcam0`；启动该设备——首次出 macOS 授权弹窗（属 emulator 进程），**同意**后设备内相机应用应见真实画面；另建一台选 webcam 后在系统设置里拒绝授权 → 启动应给出可解释失败而非静默改模拟画面。
   - 证据：config 片段、授权弹窗截图、相机取景截图（同意路径）。
3. 导入一个本地皮肤 zip → 选中 → 创建：config 断言 `skin.path` 为应用库绝对路径。

**A2 能力加载时延（P2-3）**：第 2 页固定画像下连续切换镜像 6 次，秒表记「正在加载设置能力…」可见时长。判据：首次 ≤5s（Java 冷启动一次），后续 5 次均 ≤1s（缓存命中 + 探针 ~0.2s）。证据：6 次时长记录；超时即回退（缓存未命中排查 JAR 指纹键）。

**A3 解压取消（download-cancel P2-4 尾巴）**：选未装大镜像（≥1GB 延长窗口）点下载，进度 ≥98% 后点「取消」。判据：行回下载态无错误横幅；`system-images` 下 `ls -a | grep '^\.'` 零残留（`.downloading.zip`/`.unzipping` 全清）；**立即重下全链路成功**。证据：取消前后目录 `ls -a` 对照 + 重下成功截图。

### B. 六类验收矩阵

每类标准流程：类别导航选画像 → 选该类 arm64 镜像（未装先下载）→ 附加设置默认（Cold）→ 创建 → 启动 → 投屏 → 输入 → 停止 → 删除。必留证据：向导页截图（类别+选中行）、投屏截图、输入操作录屏或日志、停后进程零残留（`pgrep -f qemu` 空）。

| 类别       | 画像/镜像组合                                    | 投屏判据             | 输入判据                           | 预期结论                                     |
| ---------- | ------------------------------------------------ | -------------------- | ---------------------------------- | -------------------------------------------- |
| phone      | Pixel 7 × google_apis_playstore 36（已装）       | ≥30fps、等比不裁切   | 触控 + 键盘 + back/home/power      | 通过（基准回归）                             |
| tablet     | Pixel Tablet × google_apis 36                    | ≥30fps、横屏比例     | 触控 + 键盘                        | 通过                                         |
| wear       | Wear OS Large Round × android-wear 35（需下载）  | 圆屏等比、无拉伸黑边 | 触控（最小集）                     | 通过或记录几何 issue                         |
| tv         | TV 画像 × android-tv 35（需下载）                | ≥30fps               | **方向键 + enter**（D-pad 最小集） | 通过或记录输入 issue                         |
| automotive | Automotive 画像 × android-automotive(-playstore) | ≥30fps               | 触控 + 键盘方向                    | 通过或记录 issue                             |
| desktop    | 桌面类任一画像                                   | —                    | —                                  | **不可创建 + 原因可见**（能力 unknown 文案） |

附：wear 表头修复回归——选 wear 类后表头/行高正常（对照修复前截图 `52d7bca`）。

### 文件与接口清单

- **不改**任何 `src/` 代码；证据落 `book/docs/` 或随验收记录嵌入 issue/plan（截图放 `docs/poc/` 惯例目录旁新开 `docs/acceptance/2026-10-06/`，索引由 book:index 处理说明——若新增目录需按 AGENTS.md 在 `scripts/gen-book-index.mjs` 目录表补行）。
- **回写面**：plan 进度段（验收结果一段）、验收遗留 issue 第 4 条勾销、新 issue（tv/wear 输入或几何缺口若有）、learn（真机踩坑若有）。
- 帧率测量沿用 stage04 真机 CDP 冒烟口径（rAF 采样 10 秒取均值）。

## Build order

1. A1 皮肤创建 → A1 摄像头（含授权两路径）→ A1 导入皮肤（半小时内完成，失败即停记录）。
2. A2 时延测量（6 次）。
3. A3 解压取消（预留多次尝试）。
4. B 基准类 phone → tablet（已装优先，先跑通流程）。
5. B 需下载类 wear → tv → automotive（每类下载 + 验收 + 删设备）。
6. B desktop 展示验证 + wear 表头回归。
7. 回写：plan / issue / learn / book:index。

## Test plan（真机判据汇总）

| #   | 项               | 判据（过线）                                                      | 证据               |
| --- | ---------------- | ----------------------------------------------------------------- | ------------------ |
| 1   | 皮肤创建         | 成功 + config `skin.name` 命中                                    | 截图 + config 片段 |
| 2   | 摄像头创建与取景 | 成功 + `hw.camera.*=webcam0` + 授权同意后真实取景；拒绝路径可解释 | config + 截图      |
| 3   | 导入皮肤创建     | 成功 + config `skin.path` 绝对路径                                | config 片段        |
| 4   | 能力时延         | 首次 ≤5s、后续 ≤1s                                                | 6 次时长记录       |
| 5   | 解压取消         | 零残留 + 立即重下成功                                             | ls -a 对照 + 截图  |
| 6   | 五类端到端       | 各自投屏/输入判据列全过或缺口已记 issue                           | 每类三件套证据     |
| 7   | desktop 诚实展示 | 不可创建 + 中文原因可见                                           | 截图               |
| 8   | wear 表头回归    | 表头正常行高                                                      | 截图（对照修复前） |

## Done criteria

- 上表 8 项各有证据落位，缺一不可宣称完成；任何一项不过线 → 当场记录、不修码、进 issue。
- 五类中无法通过的类别：能力/入口保持或调整为如实展示（记 issue 说明），不冒充已支持——对齐向导 plan Done criteria 原文。
- 回写完成后：plan 进度段更新、验收遗留 issue 第 4 条收口（或注明剩余）、`npm run book:index` 过、若新增 `docs/acceptance/` 目录则补索引目录表行。
