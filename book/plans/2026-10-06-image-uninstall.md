---
description: 已装系统镜像的应用内删除——向导镜像行入口、设备引用守卫、官方卸载路径与清单缓存联动
status: draft
created: 2026-10-06
---

# 系统镜像删除 — plan

> 用户需求：下载下来的 API 镜像允许被删除。关联 [emulator-wizard 主计划](2026-10-05-emulator-wizard.md)（镜像以 packageName 为唯一身份、三件套核验的目录体系已就位）；删除属其后续扩展，不改已勾选步骤。

## Requirements brief

镜像占磁盘（1.5–2GB/个）且会随尝试不断累积。用户需要把不再用的已装镜像从应用内删除，不必手动进 SDK 目录。

- 作用域：向导「设备」标签镜像表格中已装条目的删除入口；main 侧卸载执行与守卫；清单缓存与下载互斥联动。
- 排除项：批量删除/多选；SDK 其他组件（platform-tools、emulator 等）的管理；磁盘占用统计页面；删除正在下载任务的取消（互斥拒绝即可）。
- 边界：只允许删「完整安装且当前没有设备引用」的镜像包；删除走官方 `sdkmanager --uninstall`（对齐安装路径的官方语义）；被引用时给出引用设备清单的中文提示，不提供强制删除。

验收要求：已装行有删除按钮，点击后确认框列明后果（包目录将被删除、约 x.x GB、影响哪些创建能力）；删除成功后该行回到「下载 x.x GB」状态；被设备引用的镜像删除被拒并列出设备名；下载进行中删除被拒；删除失败给中文错误与重试。

## Impact range

| 文件 | 动作 |
| --- | --- |
| `src/shared/types.ts`、`src/shared/ipc-channels.ts` | `sdkUninstallImage: 'sdk:uninstall-image'` 通道；无新持久化类型 |
| `src/main/emulator/sdk.ts` | 复用 `runSdkManagerPackages` 形态补 `uninstallSdkManagerPackage`（spawn `--uninstall`，stderr 尾部进错误） |
| `src/main/emulator/index.ts` | handler：可信目录核验（installed 且三件套完整）→ 设备引用守卫（读 devices 域）→ 下载互斥守卫 → 卸载 → 失效 imagesCache |
| `src/main/devices/index.ts` | 导出只读查询「按 imagePackageName 引用的设备名清单」（不暴露内部数组） |
| `src/renderer/src/components/wizard/ImageTable.tsx` | 已装行加删除按钮（破坏性操作二次确认走原生 dialog 域） |
| `src/renderer/src/components/DeviceWizard.tsx`、`src/preload/api/sdk.ts` | 卸载动作接线与注入接缝（测试） |
| `__tests__/`（emulator + devices + wizard） | 守卫与 UI 用例 |

风险：引用守卫竞态（删除瞬间设备创建中——创建事务持 `creating` 态时其 imagePackageName 也算引用）；`sdkmanager --uninstall` 对半安装目录的行为（实测确认，可能需要先补目录再删的兜底）；卸载后清单缓存不刷新导致行状态滞后（复用下载后的失效路径）。

## Design

1. **入口与确认**：ImageTable 已装行在状态列加「删除」文字钮（与下载钮同视觉层级）。点击 → 原生确认框（复用 dialog 域 show，buttons ['删除','取消']，detail 列包名、manifest 大小与「创建使用该镜像的设备将需要重新下载」）。确认后调 `sdk:uninstall-image`。
2. **main 守卫链**（顺序固定，逐条中文拒绝）：
   a. 入参为合法 packageName 且在当前可信目录中、`installed === true`（半安装同样拒绝——先修复才有删除资格，避免删一半之谜）；
   b. 下载互斥：`downloading !== null` 拒绝；
   c. 设备引用：devices 域查询 `listDeviceNamesReferencing(packageName)`——含 `creating` 态设备；非空时拒绝并附设备名清单（renderer 直接展示 main 返回的错误文案，不做二次拼装）；
   d. 运行态设备引用属 c 的子集（运行设备的 imagePackageName 即引用），无需单独检查。
3. **卸载执行**：spawn `sdkmanager --uninstall <package>`（env 同安装路径）。成功判据 exit 0；随后 `scanLocalImages` 复核该包已消失——目录仍在（sdkmanager 卸载残目录的兜底：核验不过则报「卸载后仍检测到残留目录」并列路径，不静默 rm）。`imagesCache = null` 让下次拉取反映状态。
4. **renderer 联动**：卸载成功后 `reloadImages()`（复用下载完成路径）；当前选中镜像若正是被删包，选择核验派生自动清空（已有机制，验证即可）。
5. **不做**：不删 AVD userdata（属设备删除域）；不动 `local-only` 条目以外的 SDK 组件；不加设置窗全局管理页（后续有需求再立项）。

## Build order

1. devices 域引用查询 + 单测（含 creating 态）。验证：引用清单准确、不含无关设备。
2. 卸载执行体 + handler 守卫链 + 单测（mock spawn/扫描）。验证：四类拒绝路径与成功路径的中文文案、缓存失效。
3. ImageTable 删除按钮 + 确认框 + 卸载后刷新 + wizard 测试（注入接缝）。验证：选中镜像被删后创建禁用。
4. 真机：删一个已装且无引用的镜像（目录消失、行回下载态、再下载可装回）；删被引用镜像被拒并见设备名。Phase 5/6 走 book 流程。

## Test plan

- 单测：守卫链四分支；卸载成功缓存失效；残留目录报错；引用查询含 creating。
- wizard 测试：确认框流程、卸载中按钮禁用、卸载后行状态翻转、选中失效。
- 回归：下载/创建/重开恢复不受新守卫影响；lint/typecheck/prettier。

## Done criteria

- 真机完成一次无引用镜像删除与一次被引用拒绝；守卫链文案可解释；回归全绿；book 同步（PRD「镜像管理」若需补 AC 一并更新）。
