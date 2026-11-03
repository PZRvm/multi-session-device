import { app } from 'electron'
import { join } from 'node:path'

/**
 * ANDROID_USER_HOME / ANDROID_EMULATOR_HOME 的统一单源（issue 2026-10-11 问题三处置）。
 * 恒定指向应用数据目录（userData/android-user），不随 SDK 根：
 *  - 共享 Studio SDK 态不再向共享根写 android-user/（avdmanager 元数据、emulator
 *    偏好与崩溃转储此前落进 Studio 的 SDK 根，违背「共享根零写入」）；
 *  - 托管/自选态与 avd-home 同语义——SDK 根迁移不再搬它（avdmanager 偏好属应用数据）。
 * 独立小模块避免依赖环：sdkSource→sdkMigration→sdk，sdk.ts 不能反向引 sdkSource。
 * 旧 SDK 根里遗留的 android-user/ 目录由迁移引擎按普通顶层条目处理，无害。
 */
export const androidUserHomeFor = (): string => join(app.getPath('userData'), 'android-user')
