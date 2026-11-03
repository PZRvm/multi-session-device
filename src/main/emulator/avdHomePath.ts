import { app } from 'electron'
import { join } from 'node:path'

/**
 * 应用 avdHome 单源（issue review P3：此前四处各自复算，dialog 因测试依赖链
 * 本地复算导致第 5 处）——叶子模块零依赖，任何层可引。
 */
export const avdHomePath = (): string => join(app.getPath('userData'), 'avd-home')
