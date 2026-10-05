import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { DeviceProfile } from '@shared/types'
import {
  type AvdDeviceEntry,
  type RawProfileMeta,
  mergeProfiles,
  readJarProfileMetas,
  sdklibJarPathFor
} from './profileMetadata'

/**
 * 设备画像：`avdmanager list device`（可创建性真值：id/Name/OEM/Tag）+ sdklib
 * JAR 内官方 XML（屏幕/密度/折叠/API 范围/Play/摄像头等元数据），按 id 关联成
 * 富画像。Tag 不再过滤——分类规则见 profileMetadata.ts（plan 2026-10-05-emulator-wizard）。
 */

export interface ProfileListDeps {
  /** 执行器接缝：默认 spawn avdmanager list device；单测注入固定输出 */
  runner?: (avdmanagerPath: string) => Promise<string>
  avdmanagerPath: string
  /** sdklib.core.jar 路径；缺省按 sdklibJarPathFor(avdmanagerPath 所在 SDK) 推导 */
  jarPath?: string
  /** 元数据读取接缝：默认 adm-zip 解包 JAR；单测注入已解析的 XML 文本 */
  metaSource?: (jarPath: string) => RawProfileMeta[]
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

/**
 * 解析 list device 输出为条目列表（不过滤 Tag——带 Tag 的 wear/tv/desktop/
 * automotive/xr/ai-glasses 是合法画像，分类交给 classifyFormFactor）。
 */
export const parseAvdDeviceEntries = (output: string): AvdDeviceEntry[] => {
  const entries: AvdDeviceEntry[] = []
  for (const block of output.split(/-{5,}/)) {
    const id = block.match(/id:\s*\d+\s+or\s+"([^"]+)"/)?.[1]
    const name = block.match(/Name:\s*(.+)/)?.[1]?.trim()
    if (!id || !name) continue
    entries.push({
      id,
      name,
      oem: block.match(/OEM\s*:\s*(.+)/)?.[1]?.trim() || null,
      tagId: block.match(/Tag\s*:\s*(\S+)/)?.[1] ?? null
    })
  }
  return entries
}

export const avdmanagerPathFor = (sdkRoot: string): string =>
  join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager')

export async function listDeviceProfiles(deps: ProfileListDeps): Promise<DeviceProfile[]> {
  const output = await (deps.runner ?? defaultRunner)(deps.avdmanagerPath)
  const avdEntries = parseAvdDeviceEntries(output)
  const jarPath =
    deps.jarPath ?? sdklibJarPathFor(join(deps.avdmanagerPath, '..', '..', '..', '..'))
  const metas = deps.metaSource ? deps.metaSource(jarPath) : readJarProfileMetas(jarPath)
  return mergeProfiles(avdEntries, metas)
}
