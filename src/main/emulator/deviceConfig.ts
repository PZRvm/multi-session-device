import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { DeviceAdvancedSettings, DeviceMeta, DeviceConfigField } from '@shared/types'
import { cameraConfigText } from '@shared/settings-contract'
import { avdPaths, type AvdDirs } from './avd'

/**
 * 已有设备的配置读取与白名单编辑（plan 2026-10-08-device-config-edit）：
 * 只访问 id 推导的受控 AVD 路径，拒绝 symlink 与越界；差异 patch 只写允许键
 * （存储键绝不在编辑映射中），保留未知键与注释。跨文件事务见 configTransaction.ts。
 */

export const MAX_CONFIG_BYTES = 1024 * 1024

export const configPathOf = (avdName: string, dirs: AvdDirs): string =>
  join(avdPaths(avdName, dirs).dir, 'config.ini')

const errnoOf = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null

/** 根和直接父目录均不允许链接；canonical 路径也必须为受控根的直接子目录。 */
const checkConfigPath = async (avdName: string, dirs: AvdDirs): Promise<string> => {
  if (!/^[A-Za-z0-9_-]+$/.test(avdName)) throw new Error('AVD 配置路径不合法')
  const path = configPathOf(avdName, dirs)
  const root = resolve(dirs.avdHome)
  for (const directory of [root, dirname(path)]) {
    const info = await lstat(directory)
    if (info.isSymbolicLink()) throw new Error('AVD 配置目录是符号链接，已拒绝读写')
    if (!info.isDirectory()) throw new Error('AVD 配置父路径不是目录，已拒绝读写')
  }
  const rootReal = await realpath(root)
  if ((await realpath(dirname(path))) !== join(rootReal, `${avdName}.avd`)) {
    throw new Error('AVD 配置真实路径越界，已拒绝读写')
  }
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('AVD config.ini 是符号链接，已拒绝读写')
    if (!info.isFile()) throw new Error('AVD config.ini 不是普通文件，已拒绝读写')
  } catch (error) {
    if (errnoOf(error) !== 'ENOENT') throw error
  }
  return path
}

/** 受控读取：父目录与文件均核验；按打开的普通文件句柄有界读取。 */
export const readAvdConfigRaw = async (avdName: string, dirs: AvdDirs): Promise<string | null> => {
  try {
    const path = await checkConfigPath(avdName, dirs)
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (!info.isFile()) throw new Error('AVD config.ini 不是普通文件')
      if (info.size > MAX_CONFIG_BYTES) throw new Error('AVD config.ini 超过大小上限')
      // 固定上限，避免 stat 后外部扩大的文件被无界读入。
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1)
      let bytesRead = 0
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
        if (chunk.bytesRead === 0) break
        bytesRead += chunk.bytesRead
      }
      if (bytesRead > MAX_CONFIG_BYTES) throw new Error('AVD config.ini 超过大小上限')
      await checkConfigPath(avdName, dirs)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return null
    throw new Error(`AVD 配置读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 原子写 config.ini（tmp + rename；事务内的受控写入口） */
export const writeAvdConfigRaw = async (
  avdName: string,
  dirs: AvdDirs,
  content: string,
  expectedCurrent?: string
): Promise<void> => {
  if (Buffer.byteLength(content) > MAX_CONFIG_BYTES) throw new Error('AVD config.ini 超过大小上限')
  const path = await checkConfigPath(avdName, dirs)
  const tmp = `${path}.${randomUUID()}.tmp`
  const handle = await open(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await handle.writeFile(content, 'utf8')
    await handle.close()
    await checkConfigPath(avdName, dirs)
    if (
      expectedCurrent !== undefined &&
      (await readAvdConfigRaw(avdName, dirs)) !== expectedCurrent
    ) {
      throw new Error('config.ini 已被外部修改，本次写入已中止')
    }
    await rename(tmp, path)
  } catch (error) {
    await handle.close().catch(() => undefined)
    // 不沿发生变化的父目录清理临时文件。
    await checkConfigPath(avdName, dirs)
      .then(() => rm(tmp, { force: true }))
      .catch(() => undefined)
    throw error
  }
}

/** Java properties 形态解析（key=value；同键多行以最后一处为准，与 patch 语义一致） */
export const parseConfigEntries = (raw: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z0-9._-]+)\s*=\s*(.*)$/)
    if (match === null) continue
    map.set(match[1], match[2].trim())
  }
  return map
}

/** 皮肤只作外观，显式固定机型尺寸；SDK 升级回归与真实启动共用。 */
export const nativeDisplayArgs = (raw: string | null): string[] => {
  const config = parseConfigEntries(raw ?? '')
  const width = config.get('hw.lcd.width')
  const height = config.get('hw.lcd.height')
  return (config.get('skin.name') || config.get('skin.path')) &&
    [width, height].every(
      (value) =>
        value !== undefined && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
    )
    ? ['-skin', `${width}x${height}`]
    : []
}

/** 容量解析：`6144M` / `6G` / 字节数（整除 1 MiB 才换算）；无法识别返回 null */
export const storageMiBFromText = (text: string | undefined): number | null => {
  if (text === undefined) return null
  const match = text.trim().match(/^(\d+)([MGmg])?$/)
  if (match === null) return null
  const size = Number(match[1])
  if (match[2] === undefined) {
    const mib = size / (1024 * 1024)
    return Number.isInteger(mib) ? mib : null
  }
  return match[2].toLowerCase() === 'g' ? size * 1024 : size
}

/** 编辑指纹：原配置字节 + 设备持久字段（任何一方变化都使编辑窗口的指纹失效） */
export const configFingerprintOf = (configRaw: string | null, meta: DeviceMeta): string =>
  createHash('sha1')
    .update(JSON.stringify({ config: configRaw, meta }))
    .digest('hex')

export interface ConfigEditPatch {
  /** 只覆盖白名单键；未含键一律不写 */
  sets: Record<string, string>
  /** 需要删除的键（清空皮肤/朝向的旧键残留） */
  deletes: string[]
}

/**
 * 设置差异 → config 编辑 patch：只比较可写字段，未变化字段不重写；
 * `disk.dataPartition.size` 永不出现在结果里（防御性断言）。
 */
export const buildConfigEditPatch = (
  original: DeviceAdvancedSettings,
  target: DeviceAdvancedSettings,
  deps: {
    skinDirectoryFor: (skinRef: string) => string
    forceFields?: readonly DeviceConfigField[]
  }
): ConfigEditPatch => {
  const sets: Record<string, string> = {}
  const deletes: string[] = []
  const changed = (field: DeviceConfigField): boolean =>
    deps.forceFields?.includes(field) === true ||
    JSON.stringify(original[field]) !== JSON.stringify(target[field])
  if (changed('cpuCores')) sets['hw.cpu.ncore'] = String(target.cpuCores)
  if (changed('ramMiB')) sets['hw.ramSize'] = String(target.ramMiB)
  if (changed('vmHeapMiB')) sets['vm.heapSize'] = String(target.vmHeapMiB)
  if (changed('graphics')) sets['hw.gpu.mode'] = target.graphics
  if (changed('frontCamera')) {
    sets['hw.camera.front'] = cameraConfigText(target.frontCamera)
  }
  if (changed('rearCamera')) {
    sets['hw.camera.back'] = cameraConfigText(target.rearCamera)
  }
  if (changed('orientation')) {
    if (target.orientation === null) deletes.push('hw.initialOrientation')
    else sets['hw.initialOrientation'] = target.orientation
  }
  if (changed('skinRef')) {
    // 清空皮肤删除三键残留；选皮肤写 skin.name（导入/下载皮肤另写 skin.path）
    if (target.skinRef === null) {
      deletes.push('skin.name', 'skin.path', 'skin.dynamic')
    } else {
      sets['skin.name'] = target.skinRef.replace(/^(sdk|imported|downloaded):/, '')
      if (target.skinRef.startsWith('sdk:')) {
        deletes.push('skin.path')
      } else {
        sets['skin.path'] = deps.skinDirectoryFor(target.skinRef)
      }
      deletes.push('skin.dynamic')
    }
  }
  if ('disk.dataPartition.size' in sets) {
    throw new Error('编辑映射试图写入内部存储键，已拒绝（不可变边界）')
  }
  return { sets, deletes }
}

/** 应用 patch 到原文：set 键全部重写（含重复行），delete 键整行移除，缺失的
 *  set 键追加到内容末尾（保留原文的结尾换行语义与注释/未知键） */
export const applyConfigPatchToText = (original: string, patch: ConfigEditPatch): string => {
  const seen = new Set<string>()
  const kept = original.split('\n').filter((line) => {
    const match = line.match(/^([A-Za-z0-9._-]+)\s*=/)
    return match === null || !patch.deletes.includes(match[1])
  })
  const rewritten = kept.map((line) => {
    const match = line.match(/^([A-Za-z0-9._-]+)\s*=/)
    if (match === null || !(match[1] in patch.sets)) return line
    seen.add(match[1])
    return `${match[1]}=${patch.sets[match[1]]}`
  })
  const appended = Object.entries(patch.sets)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}=${value}`)
  // split 产生的尾部空串不参与拼接（追加键贴着内容末尾），结尾换行按原文补回
  const body =
    rewritten.length > 0 && rewritten[rewritten.length - 1] === ''
      ? [...rewritten.slice(0, -1), ...appended]
      : [...rewritten, ...appended]
  return body.join('\n') + (original.endsWith('\n') ? '\n' : '')
}

/**
 * 所装 emulator 的 hardware-properties schema 默认值（`<sdk>/emulator/lib/
 * hardware-properties.ini`）：条目用 `name = key` 定义。只提取
 * name→default 映射；文件缺失/解析失败收敛为空表（回填字段按 unknown 说明）。
 */
export const readHardwareSchemaDefaults = async (
  sdkRoot: string,
  deps: { readFile?: (path: string) => Promise<string> } = {}
): Promise<Record<string, string>> => {
  const read = deps.readFile ?? ((path: string) => readFile(path, 'utf8'))
  let raw: string
  try {
    raw = await read(join(sdkRoot, 'emulator', 'lib', 'hardware-properties.ini'))
  } catch {
    return {}
  }
  const defaults: Record<string, string> = {}
  let current: string | null = null
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (text.length === 0 || text.startsWith('#')) {
      continue
    }
    const attr = text.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/)
    if (attr === null) continue
    if (attr[1] === 'name')
      current = /^[A-Za-z0-9._-]+$/.test(attr[2].trim()) ? attr[2].trim() : null
    if (attr[1] === 'default' && current !== null) defaults[current] = attr[2].trim()
  }
  return defaults
}
