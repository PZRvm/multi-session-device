import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageEntry } from '@shared/types'
import { VARIANT_DIRS } from './catalog'
import type { DeviceProfileDef } from './profiles'

/**
 * AVD 目录操作（手写 config 路线）。
 * avdmanager 在 cmdline-tools 19/20 上无法解析 SDK 根（issue 2026-10-04-avdmanager-sdk-root-null），
 * 而 emulator 只读 `<avdHome>/<name>.ini` + `<name>.avd/config.ini`——直接写这两个文件即可，
 * 结构以 Android Studio 生成的 AVD 为参照（PoC 已实测冷启动 9s、链路 59fps）。
 */

const TAG_DISPLAY: Record<ImageEntry['variant'], string> = {
  aosp: 'Android Open Source Project',
  google_apis: 'Google APIs',
  google_play: 'Google Play'
}

export interface AvdDirs {
  /** 应用自有 AVD 根（ANDROID_AVD_HOME 语义） */
  avdHome: string
}

export const avdPaths = (
  avdName: string,
  dirs: AvdDirs
): { ini: string; dir: string; config: string } => ({
  ini: join(dirs.avdHome, `${avdName}.ini`),
  dir: join(dirs.avdHome, `${avdName}.avd`),
  config: join(dirs.avdHome, `${avdName}.avd`, 'config.ini')
})

export const avdExists = async (avdName: string, dirs: AvdDirs): Promise<boolean> => {
  try {
    await readFile(avdPaths(avdName, dirs).ini, 'utf8')
    return true
  } catch {
    return false
  }
}

export interface CreateAvdInput {
  /** AVD 名 = 设备 id（uuid，文件名安全；重命名只改元数据不改 AVD 名） */
  avdName: string
  profile: DeviceProfileDef
  entry: ImageEntry
}

export async function createAvd(input: CreateAvdInput, dirs: AvdDirs): Promise<string> {
  const { avdName, profile, entry } = input
  if (!/^[A-Za-z0-9._-]+$/.test(avdName)) {
    throw new Error(`非法 AVD 名（${avdName}）：只允许字母数字点下划线连字符`)
  }
  const paths = avdPaths(avdName, dirs)
  if (await avdExists(avdName, dirs)) {
    throw new Error(`AVD 已存在（${paths.ini}）`)
  }
  const ini = [
    'avd.ini.encoding=UTF-8',
    `path=${paths.dir}`,
    `target=android-${entry.apiLevel}`
  ].join('\n')
  const config = [
    `AvdId=${avdName}`,
    `PlayStore.enabled=${entry.variant === 'google_play'}`,
    'abi.type=arm64-v8a',
    `avd.ini.displayname=${avdName}`,
    'avd.ini.encoding=UTF-8',
    'disk.dataPartition.size=6G',
    'hw.accelerometer=yes',
    'hw.arc=false',
    'hw.battery=yes',
    'hw.cpu.arch=arm64',
    'hw.cpu.ncore=4',
    'hw.device.manufacturer=Google',
    `hw.device.name=${profile.id}`,
    'hw.gps=yes',
    'hw.gpu.enabled=yes',
    'hw.gpu.mode=auto',
    'hw.initialOrientation=portrait',
    'hw.keyboard=yes',
    `hw.lcd.density=${profile.density}`,
    `hw.lcd.height=${profile.lcdHeight}`,
    `hw.lcd.width=${profile.lcdWidth}`,
    `hw.ramSize=${profile.ramSize}`,
    'hw.sdCard=no',
    `image.sysdir.1=system-images/android-${entry.apiLevel}/${VARIANT_DIRS[entry.variant].tag}/arm64-v8a/`,
    'runtime.network.latency=none',
    'runtime.network.speed=full',
    'showDeviceFrame=no',
    `tag.display=${TAG_DISPLAY[entry.variant]}`,
    `tag.id=${VARIANT_DIRS[entry.variant].tag}`,
    `target=android-${entry.apiLevel}`,
    'vm.heapSize=336'
  ].join('\n')

  await mkdir(paths.dir, { recursive: true })
  await writeFile(paths.ini, `${ini}\n`, 'utf8')
  await writeFile(paths.config, `${config}\n`, 'utf8')
  return paths.dir
}

/** 删除 AVD 目录与 ini；文件不存在按已删成功（fs.rm force 语义，容忍手动删过一半） */
export async function deleteAvd(avdName: string, dirs: AvdDirs): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(avdName)) {
    throw new Error(`非法 AVD 名（${avdName}）`)
  }
  const paths = avdPaths(avdName, dirs)
  await rm(paths.dir, { recursive: true, force: true })
  await rm(paths.ini, { force: true })
}
