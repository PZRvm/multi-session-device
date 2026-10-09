---
description: 修复编辑页写入 virtualScene 导致 Android 摄像头为零和相机闪退，并支持保存修正历史配置
status: completed
created: 2026-10-09
---

# 虚拟场景摄像头编辑修复

## Step 0：需求与边界

用户将 Pixel 8/API 32 摄像头改为虚拟场景后，打开 Android 相机立即闪退。排查并修复这条编辑保存链路，保留相机模式、其他配置及用户数据。

范围：编辑摄像头值映射、错误字面量的配置偏差检测及相关回归。不改 emulator、系统镜像、存储、GPU、摄像头仲裁和其他设备；不清空用户数据，不批量迁移旧配置。

## Phase 1：已确认的根因

2026-10-09 13:40（UTC+8），复制用户 AVD 的普通文件到临时目录，使用独立端口和 `-read-only` 复现：

- 原配置前后摄像头均为 `virtualScene`。Android `dumpsys media.camera` 返回 0 个摄像头；`com.android.camera2` 打开时崩溃，`ArrayIndexOutOfBoundsException: length=0; index=0`。模拟器进程和 Android 系统继续运行。
- 仅将副本配置改为小写 `virtualscene`：注册 1 个后置场景摄像头，相机进程存活、预览打开、crash 缓冲为空。
- 创建路径已经使用 `cameraConfigText`；编辑的 `cameraConfigValue` 仍直接输出内部 camelCase 枚举。`configMismatchesOf` 又将两种字面量视为等价，历史错误值不能通过原样保存修复。

证据在本机临时目录 `/var/folders/r8/m81f7g6102x8s3fg8fjrpbv00000gn/T/msd-camera-investigate-qegpdj79/`。临时目录可能被系统清理；复现方法和错误正文以本页及对应 issue 为准。

## Phase 2：设计

1. 编辑映射复用 shared 的 `cameraConfigText`，创建和编辑共用写入规则。
2. 配置偏差只接受 emulator 实际识别的小写 `virtualscene`。历史 `virtualScene` 作为不可采用的错误值报告；沿用既有保存流程的 `forceFields`，即使表单值未变也修正相应配置键。
3. 保留 metadata 内部枚举 `virtualScene`、事务与指纹保护。仅在用户保存时写入，启动和读配置不自动修改文件。

代码范围：2 个生产文件（`deviceConfig.ts`、`configDrift.ts`）与 3 个既有测试文件；不新增依赖或接口。

## Phase 3–4：实现与验证

- [x] 先补失败回归：新增 6 项在旧实现全部失败（前后映射各 1、偏差同步各 1、完整编辑和原样修复各 1）；原有 148 项通过。
- [x] 最小实现后相关回归 154 项通过；全量 48 个文件通过、3 个跳过，697 项通过、6 项跳过。`npm run build`（含 node/web typecheck）、`npm run lint`、`npx prettier --check src` 通过。
- [x] 直接调用修复后的 `configMismatchesOf` → `configBaseline` → `buildConfigEditPatch` → `applyConfigPatchToText`，从用户原配置生成修复配置。仅前后摄像头两行改为小写，无删除；重新启动 AVD 副本后注册 1 个摄像头，CameraActivity 在前台、场景预览正常、相机 PID 1502 存活、crash 缓冲为空。

## Phase 5–6：收尾

- [x] 八项 review 检查单核对完成，无新增问题。映射共用；保存沿用授权、指纹及事务边界；历史错误值不可采用、保存同步；未引入依赖和自动迁移。已有时间戳警告继续留在 issue，未扩大修复范围。
- [x] 回写 issue、learn、stage 与索引。用户实际 config.ini 的 SHA-256 与诊断前一致；临时模拟器均已停止，未动既有 5554 孤儿进程。

## DEBUG REPORT

| 字段            | 结果                                                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Symptom         | 将摄像头设为虚拟场景后，打开 Android 相机立即退出。                                                                                                                                                                                                                         |
| Root cause      | 编辑保存输出 `virtualScene`，emulator 37.2.12 只识别 `virtualscene`，Android 得到 0 个摄像头；AOSP 相机读取索引 0 时越界。偏差检测又误认错误大小写等价，原样保存无法修复。                                                                                                  |
| Fix             | `src/main/emulator/deviceConfig.ts:187`、`:190` 复用共享映射；`src/main/emulator/configDrift.ts:19` 将错误大小写报告为不可采用，已有保存同步路径修正旧文件。                                                                                                                |
| Evidence        | 原配置副本：0 个摄像头、`ArrayIndexOutOfBoundsException: length=0; index=0`、相机 PID 为空，模拟器仍存活。仅大小写对照及修复代码生成的配置：1 个摄像头、预览正常、crash 缓冲为空。全量输出：`Test Files 48 passed / 3 skipped (51)`，`Tests 697 passed / 6 skipped (703)`。 |
| Regression test | `src/main/emulator/__tests__/deviceConfig.test.ts:202`、`src/main/emulator/__tests__/configDrift.test.ts:94`、`src/main/devices/__tests__/index.test.ts:2278` 和 `:2301`，新增 6 项已证红绿。                                                                               |
| Related         | [原 issue](../notes/issue/2026-10/2026-10-09-config-safety-followup-audit.md)、[摄像头兼容 learn](../notes/learn/2026-10/2026-10-09-emulator-camera-arg-compat.md)。此前修复覆盖创建，漏掉独立编辑映射；时间戳异常与本次已复现的崩溃分开跟踪。                              |
| Status          | DONE：根因、代码修复、回归和同数据副本复验完成。用户实际 AVD 未改动；应用重启后，在该设备编辑页直接保存一次，再启动，使历史错误配置同步为小写。                                                                                                                             |
