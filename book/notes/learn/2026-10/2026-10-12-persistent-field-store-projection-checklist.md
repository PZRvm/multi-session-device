---
description: 持久字段新增的完整落点清单——types/toMeta 之外还有 store 白名单投影与校验；漏投影的表象是读丢字段+切来源即冻结写入（误判外部修改）
created: 2026-10-12
tags: [store, persistence, whitelist-projection, devices, debugging, electron]
---

# 持久字段漏登 store 投影白名单：读丢字段 + 切来源即冻结

来源：plan 2026-10-12-device-list-source-aware 验收期修复批 2（用户真机三连报障的统一根因）。

## 1. 新增持久字段必须同步四处，缺一不可

devices.json 的字段走**白名单投影**（`store.ts` `projectV2Meta`：「未知顶层/嵌套键不进内存、不随写回盘」）——新增 `DeviceMeta` 字段时只改 types + toMeta 是不够的：

1. `src/shared/types.ts`——类型声明；
2. `src/main/devices/index.ts` `toMeta`——写侧透传；
3. `src/main/store.ts` `projectV2Meta`——**读侧投影白名单**（漏了 = 字段写得出、读回来就没了）；
4. `src/main/store.ts` `firstInvalidV2Field`——可选字段的类型/闭集校验（照 `cutoutResetPending` 模式）。

本批漏了 3/4 两处。表象极有迷惑性：**文件里字段好好的**（查盘以为没问题），应用行为却像字段不存在。

## 2. 漏投影会级联成「切来源即冻结写入」——不止是显示丢字段

冻结链条：创建提交后内存 `acceptedMetas` 带字段 → 触发 `rereadStore`（来源切换重查/重新检查都会走）→ 读侧投影把字段剥掉 → `metasEqual(投影版, 内存版)` 判false → **误判「外部修改」→ `armStoreProtection` + read-only → 创建/删除/改名全被 `assertMetaWritable` 拦截**。重启后投影版与内存版一致（都缺字段）→ 解冻——「重启才能用」的假象由此而来。排查时看到「元数据写入已冻结」先想投影差异，别急着怀疑外部真改了文件。

## 3. 排查教训：数据文件正常 ≠ 链路正常

本次先入为主走了弯路：看到 devices.json 里字段在，就去查构建混用/双实例（那问题真实存在但不是本次主因）。正确的定位动作是**沿着读写路径各走一遍**：写入入口（toMeta/writeDeviceMetas）与读取出口（readDeviceStore/projectV2Meta）分开验证——一个「文件有、行为没有」的字段，问题必在读侧变换，不在数据。

## 4. 相邻隐患（另立 issue）：无单实例锁 + 多构建共享 userData

`requestSingleInstanceLock` 全仓库缺失；主仓库与 worktree 的 dev 构建同包名 → 同一 `userData` 目录。并行运行时两实例互踩 devices.json/avd-home（删除被对方提交复活、互相触发冻结）。create-worktree 只隔离了渲染端口，没隔离数据目录——测试纪律：同一时间只跑一个构建。
