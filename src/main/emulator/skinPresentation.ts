import { readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import type { DeviceSkinPresentation } from '@shared/types'
import { renderableArtFiles, scanImportedSkins, scanSdkSkins } from './skins'
import { skinImageMime } from './skinSource'

export const readSkinPresentation = async (
  skinRef: string | null,
  sdkRoot: string,
  userData: string
): Promise<DeviceSkinPresentation | null> => {
  if (skinRef === null) return null
  const records = [...(await scanSdkSkins(sdkRoot)), ...(await scanImportedSkins(userData))]
  const record = records.find((skin) => skin.skinRef === skinRef)
  if (!record) throw new Error('已选皮肤已丢失或 layout 损坏，请重新导入或获取')
  const root = await realpath(record.directory)
  // 目录本身也不能通过符号链接逃出应用库。
  const library = await realpath(
    record.source === 'sdk' ? join(sdkRoot, 'skins') : join(userData, 'device-skins')
  )
  const contained = (base: string, path: string): boolean => {
    const rel = relative(base, path)
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
  }
  if (!contained(library, root)) throw new Error('皮肤目录越界')
  // 可渲染素材清单与导入/扫描校验同源（renderableArtFiles）；正常入库的皮肤
  // 不会为零，此处保留兜底以防库目录被外部改动
  const files = renderableArtFiles(record.layout)
  if (files.length === 0 || files.length > 32) throw new Error('皮肤没有可渲染的背景图片')
  let total = 0
  const images: DeviceSkinPresentation['images'] = []
  for (const file of files) {
    if (!/^[\w.-]+$/.test(file)) throw new Error('皮肤素材引用越界')
    const path = await realpath(join(root, file))
    const info = await stat(path)
    total += info.size
    if (
      !contained(root, path) ||
      !info.isFile() ||
      info.size > 16 * 1024 * 1024 ||
      total > 64 * 1024 * 1024
    )
      throw new Error('皮肤素材越界或体积超限')
    const bytes = await readFile(path)
    images.push({ file, url: `data:${skinImageMime(bytes)};base64,${bytes.toString('base64')}` })
  }
  return {
    name: record.name,
    portrait: record.layout.portrait,
    landscape: record.layout.landscape,
    images
  }
}
