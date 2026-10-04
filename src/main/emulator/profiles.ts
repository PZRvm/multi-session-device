import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { DeviceProfile } from '@shared/types'

/**
 * 设备画像：`avdmanager list device` 真数据。
 * 输出里带 `Tag :` 行的定义是非手机类（automotive/wear/tv/desktop/xr/ai-glasses），
 * 手机/平板条目没有 Tag 行——以此过滤；id/Name 之外的字段一期不展示。
 * （内置目录方案随 2026-10-05 avdmanager 修复退役，见 plan 2026-10-04-avd-create-delete 变更记录。）
 */

export interface ProfileListDeps {
  /** 执行器接缝：默认 spawn avdmanager list device；单测注入固定输出 */
  runner?: (avdmanagerPath: string) => Promise<string>
  avdmanagerPath: string
}

const defaultRunner = (avdmanagerPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(avdmanagerPath, ['list', 'device'], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else {
        reject(
          new Error(
            `avdmanager list device 失败（exit ${code}）：${Buffer.concat(err).toString('utf8').slice(-400)}`
          )
        )
      }
    })
  })

/** 解析 list device 输出：无 `Tag :` 行的定义（手机/平板），按名称排序 */
export const parseDeviceProfiles = (output: string): DeviceProfile[] => {
  const profiles: DeviceProfile[] = []
  for (const block of output.split(/-{5,}/)) {
    const id = block.match(/id:\s*\d+\s+or\s+"([^"]+)"/)?.[1]
    const name = block.match(/Name:\s*(.+)/)?.[1]?.trim()
    if (!id || !name) continue
    if (/^\s*Tag\s*:/m.test(block)) continue
    profiles.push({ id, name })
  }
  return profiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export const avdmanagerPathFor = (sdkRoot: string): string =>
  join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager')

export async function listDeviceProfiles(deps: ProfileListDeps): Promise<DeviceProfile[]> {
  const output = await (deps.runner ?? defaultRunner)(deps.avdmanagerPath)
  return parseDeviceProfiles(output)
}
