import type { DeviceProfile } from '@shared/types'

/** 内置画像 = 共享 DeviceProfile 契约（硬件参数写 config.ini 用，取公开设备定义常用档位） */
export type DeviceProfileDef = DeviceProfile

/**
 * 设备画像目录（手机/平板）。
 * avdmanager list device 在 cmdline-tools 19/20 上不可用（issue 2026-10-04-avdmanager-sdk-root-null），
 * 一期改为内置目录：一期 macOS + arm64 + 常用 Pixel 系画像即可覆盖目标用户；
 * 扩充/来源化（avdmanager 或 devices.xml 解析）留待后续版本。
 */
export const DEVICE_PROFILES: DeviceProfileDef[] = [
  {
    id: 'pixel_6a',
    name: 'Pixel 6a',
    lcdWidth: 1080,
    lcdHeight: 2400,
    density: 420,
    ramSize: 2048
  },
  { id: 'pixel_7', name: 'Pixel 7', lcdWidth: 1080, lcdHeight: 2400, density: 420, ramSize: 2048 },
  {
    id: 'pixel_7_pro',
    name: 'Pixel 7 Pro',
    lcdWidth: 1440,
    lcdHeight: 3120,
    density: 560,
    ramSize: 2048
  },
  { id: 'pixel_8', name: 'Pixel 8', lcdWidth: 1080, lcdHeight: 2400, density: 420, ramSize: 2048 },
  {
    id: 'pixel_8a',
    name: 'Pixel 8a',
    lcdWidth: 1080,
    lcdHeight: 2400,
    density: 420,
    ramSize: 2048
  },
  {
    id: 'pixel_8_pro',
    name: 'Pixel 8 Pro',
    lcdWidth: 1344,
    lcdHeight: 2992,
    density: 480,
    ramSize: 2048
  },
  { id: 'pixel_9', name: 'Pixel 9', lcdWidth: 1080, lcdHeight: 2424, density: 420, ramSize: 2048 },
  {
    id: 'pixel_9_pro',
    name: 'Pixel 9 Pro',
    lcdWidth: 1280,
    lcdHeight: 2856,
    density: 480,
    ramSize: 2048
  },
  {
    id: 'pixel_tablet',
    name: 'Pixel Tablet',
    lcdWidth: 1600,
    lcdHeight: 2560,
    density: 276,
    ramSize: 2048
  }
]

export const findDeviceProfile = (id: string): DeviceProfileDef | undefined =>
  DEVICE_PROFILES.find((profile) => profile.id === id)
