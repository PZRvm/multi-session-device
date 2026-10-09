// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import {
  buildPackageXml,
  downloadImagePackage,
  downloadImageZip,
  installImageZip,
  verifyPackageInstall,
  CancelledError
} from '../downloader'

const IDENTITY_XML =
  '<repository><localPackage path="system-images;android-36.1;google_apis_playstore;arm64-v8a"/></repository>'

const TARGET = {
  packageName: 'system-images;android-36.1;google_apis_playstore;arm64-v8a',
  zipUrl:
    'https://dl.google.com/android/repository/sys-img/google_apis_playstore/arm64-v8a-36.1_r04.zip',
  zipSha1: 'a'.repeat(40),
  sizeBytes: 1000,
  displayName: 'Google Play ARM 64 v8a System Image',
  apiLevelText: '36.1',
  extensionLevel: 20,
  tagIds: ['google_apis_playstore'],
  abi: 'arm64-v8a',
  revision: { major: 4, minor: null, micro: null }
}

describe('直连镜像身份必须被官方工具识别', () => {
  it('类型声明、ABI 列表和每个 tag 的显示名齐全；使用 sys-img schema', () => {
    const xml = buildPackageXml({ ...TARGET, tagIds: ['google_apis_playstore', 'ps16k'] })
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml)
    const repo = parsed['ns2:repository']
    const details = repo.localPackage['type-details']
    expect(repo['@_xmlns:xsi']).toBe('http://www.w3.org/2001/XMLSchema-instance')
    expect(repo['@_xmlns:sysimg']).toBe('http://schemas.android.com/sdk/android/repo/sys-img2/05')
    expect(details['@_xsi:type']).toBe('sysimg:sysImgDetailsType')
    expect(details.abi).toBe(TARGET.abi)
    expect(details.abis).toBe(TARGET.abi)
    expect(details.tag).toEqual([
      { id: 'google_apis_playstore', display: 'Google Play' },
      { id: 'ps16k', display: 'ps16k' }
    ])
  })
})

/** 内存流 + 文件系统全注入的执行环境 */
interface EnvState {
  dirs: Set<string>
  files: Set<string>
  moved: Array<[string, string]>
  removed: string[]
}

interface MakeEnvOverrides {
  chunks?: number[]
  chunkSize?: number
  sha1?: string
  zipEntries?: string[]
}

const makeEnv = (
  overrides: MakeEnvOverrides = {}
): {
  deps: Record<string, unknown>
  state: EnvState
  written: Array<{ path: string; data: string }>
} => {
  const chunkSize = overrides.chunkSize ?? 10
  const chunks = overrides.chunks ?? Array.from({ length: 100 }, () => chunkSize)
  const state = {
    dirs: new Set<string>(),
    files: new Set<string>(),
    moved: [] as Array<[string, string]>,
    removed: [] as string[]
  }
  const written: Array<{ path: string; data: string }> = []
  const readDirOf = async (dir: string): Promise<string[]> => {
    const names = new Set<string>()
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    for (const entry of state.files) {
      if (entry.startsWith(prefix)) names.add(entry.slice(prefix.length).split('/')[0])
    }
    for (const entry of state.dirs) {
      if (entry.startsWith(prefix) && entry !== dir) {
        names.add(entry.slice(prefix.length).split('/')[0])
      }
    }
    return [...names]
  }
  const fsDeps = {
    written,
    readDir: readDirOf,
    writeFile: async (path: string, data: string) => {
      state.files.add(path)
      written.push({ path, data })
    },
    pathExists: async (path: string) => state.dirs.has(path) || state.files.has(path),
    makeDir: async (dir: string) => {
      state.dirs.add(dir)
    },
    moveDir: async (from: string, to: string) => {
      state.moved.push([from, to])
      state.dirs.add(to)
      state.dirs.delete(from)
      // 目录树整体移动：目录下文件前缀跟随重写
      for (const file of [...state.files]) {
        if (file.startsWith(`${from}/`)) {
          state.files.delete(file)
          state.files.add(`${to}${file.slice(from.length)}`)
        }
      }
    },
    removePath: async (path: string) => {
      state.removed.push(path)
      state.dirs.delete(path)
      state.files.delete(path)
    }
  }
  const deps = {
    ...fsDeps,
    readFile: async () => IDENTITY_XML,
    openUrl: async () => ({
      // 100 个 chunk × 10B = 1000B（与 sizeBytes 一致）
      stream: (async function* (): AsyncGenerator<Uint8Array> {
        for (const size of chunks) {
          yield new Uint8Array(size)
        }
      })(),
      totalBytes: chunks.reduce((sum, size) => sum + size, 0)
    }),
    now: (() => {
      let t = 0
      return () => (t += 1000) // 每次读时都过 500ms 节流窗
    })(),
    sha1Of: async () => overrides.sha1 ?? TARGET.zipSha1,
    extractZip: async (_zip: string, dir: string) => {
      state.dirs.add(dir)
      // 真机实证（android-21 zip）：首层即 <abi>/，不带 platform/tag 层
      for (const entry of overrides.zipEntries ?? [
        'arm64-v8a/source.properties',
        'arm64-v8a/system.img',
        'arm64-v8a/userdata.img'
      ]) {
        state.files.add(`${dir}/${entry}`)
        const segments = entry.split('/')
        for (let i = 1; i <= segments.length; i += 1) {
          state.dirs.add(`${dir}/${segments.slice(0, i).join('/')}`)
        }
      }
    }
  }
  return { deps, state, written }
}

describe('downloadImageZip（真实百分比与节流）', () => {
  it('进度随字节单调推进且封顶 99（100% 保留给全链路成功）', async () => {
    const { deps } = makeEnv()
    const percents: number[] = []
    await downloadImageZip('/sdk', TARGET, (p) => percents.push(p), deps)
    expect(percents.length).toBeGreaterThan(3)
    // 单调不减
    expect([...percents].sort((a, b) => a - b)).toEqual(percents)
    expect(Math.max(...percents)).toBe(99)
  })

  it('sha1 不符：删临时文件并抛中文错误', async () => {
    const { deps, state } = makeEnv({ sha1: 'b'.repeat(40) })
    await expect(downloadImageZip('/sdk', TARGET, () => {}, deps)).rejects.toThrow('完整性校验失败')
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })

  it('无 zipUrl 的包拒绝（不支持应用内下载）', async () => {
    await expect(
      downloadImageZip('/sdk', { ...TARGET, zipUrl: null }, () => {}, {})
    ).rejects.toThrow('不支持应用内下载')
  })

  it('下载流中断：清理临时文件并抛原始错误', async () => {
    const { deps, state } = makeEnv()
    const failing = {
      ...deps,
      openUrl: async () => ({
        stream: (async function* (): AsyncGenerator<Uint8Array> {
          yield new Uint8Array(10)
          throw new Error('网络中断')
        })(),
        totalBytes: 1000
      })
    }
    await expect(downloadImageZip('/sdk', TARGET, () => {}, failing)).rejects.toThrow('网络中断')
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })
})

describe('installImageZip（落位/核验/回滚）', () => {
  const zipPathOf = (packageName: string): string =>
    `/sdk/system-images/.${packageName.replace(/[;/:]/g, '_')}.downloading.zip`

  it('合法布局：abi 子树整体落位、核验通过、清临时物', async () => {
    const { deps, state, written } = makeEnv()
    await installImageZip('/sdk', TARGET, zipPathOf(TARGET.packageName), deps)
    const dest = '/sdk/system-images/android-36.1/google_apis_playstore/arm64-v8a'
    expect(state.moved.some(([, to]) => to === dest)).toBe(true)
    expect(state.removed.some((path) => path.includes('.unzipping'))).toBe(true)
    // package.xml 由 manifest 元数据生成（zip 不带）
    const generated = written.find((w) => w.path.endsWith('package.xml'))
    expect(generated?.data).toContain(`path="${TARGET.packageName}"`)
    expect(generated?.data).toContain('<api-level>36.1</api-level>')
  })

  it('布局不符（无 system.img）：拒绝落位并抛错', async () => {
    const { deps } = makeEnv({
      zipEntries: ['some-other-layout/readme.txt']
    })
    await expect(
      installImageZip('/sdk', TARGET, zipPathOf(TARGET.packageName), deps)
    ).rejects.toThrow('布局与预期不符')
  })

  it('核验失败（身份不符）：回滚落位并恢复备份', async () => {
    const { deps, state } = makeEnv()
    const dest = '/sdk/system-images/android-36.1/google_apis_playstore/arm64-v8a'
    // 预置已存在的目标目录（半安装残留）——应先备份
    state.dirs.add(dest)
    // 核验失败：package.xml 身份不匹配（文件存在但内容非本包）
    const failing = {
      ...deps,
      pathExists: async (path: string) =>
        state.dirs.has(path) || state.files.has(path) || path.endsWith('system.img') === false
    }
    // verifyPackageInstall 走真实 readFile——注入 pathExists 不能让它读到身份，
    // 这里改用「缺 source.properties」路径：把文件集合里的 source.properties 去掉
    state.files.forEach((f) => {
      if (f.endsWith('source.properties')) state.files.delete(f)
    })
    const fsLike = {
      ...failing,
      pathExists: async (path: string) => {
        if (path.endsWith('source.properties') && path.includes(dest)) return false
        return state.dirs.has(path) || state.files.has(path)
      }
    }
    await expect(
      installImageZip('/sdk', TARGET, zipPathOf(TARGET.packageName), fsLike)
    ).rejects.toThrow('安装核验失败')
    // 本次落位被回滚
    expect(state.removed.includes(dest)).toBe(true)
  })

  it('回滚失败不吞：主错误之上叠加残留路径（review P3，对齐设备创建事务标准）', async () => {
    const { deps, state } = makeEnv()
    const dest = '/sdk/system-images/android-36.1/google_apis_playstore/arm64-v8a'
    // 预置已存在目标目录 → 走备份路径；核验失败（缺 source.properties）
    state.dirs.add(dest)
    state.files.forEach((f) => {
      if (f.endsWith('source.properties')) state.files.delete(f)
    })
    const fsLike = {
      ...deps,
      pathExists: async (path: string) => {
        if (path.endsWith('source.properties') && path.includes(dest)) return false
        return state.dirs.has(path) || state.files.has(path)
      },
      // 落位/恢复涉及 destDir 的移动全部失败（模拟磁盘/权限异常）
      moveDir: async (from: string, to: string) => {
        if (to === dest) throw new Error('move boom')
        await (deps.moveDir as (from: string, to: string) => Promise<void>)(from, to)
      }
    }
    await expect(
      installImageZip('/sdk', TARGET, zipPathOf(TARGET.packageName), fsLike)
    ).rejects.toThrow('回滚未完全成功')
  })
})

describe('review 修复回归（P1 写错误 / P2b 顺序）', () => {
  it('P1：写流中途出错——抛错并清理临时 zip，不崩不挂死', async () => {
    const { deps, state } = makeEnv()
    const failOnChunk = 5
    const withBadSink = {
      ...deps,
      createSink: () => {
        let written = 0
        let failed = false
        return {
          write: (): boolean => {
            written += 1
            if (written >= failOnChunk) {
              failed = true
              throw new Error('ENOSPC: 磁盘已满')
            }
            return true
          },
          finish: async () => {
            if (failed) throw new Error('ENOSPC: 磁盘已满')
          },
          destroy: () => undefined,
          waitDrain: async () => {
            if (failed) throw new Error('ENOSPC: 磁盘已满')
          }
        }
      }
    }
    await expect(downloadImageZip('/sdk', TARGET, () => {}, withBadSink)).rejects.toThrow(
      '磁盘已满'
    )
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })

  it('P1：背压等待中出错——waitDrain reject 传播', async () => {
    const { deps } = makeEnv()
    const withSlowSink = {
      ...deps,
      createSink: () => ({
        write: (): boolean => false, // 永远触发背压
        finish: async () => undefined,
        destroy: () => undefined,
        waitDrain: async () => {
          throw new Error('EIO: 写入失败')
        }
      })
    }
    await expect(downloadImageZip('/sdk', TARGET, () => {}, withSlowSink)).rejects.toThrow('EIO')
  })

  it('P2b：package.xml 的 localPackage 子元素顺序对齐官方 XSD sequence', () => {
    const xml = buildPackageXml(TARGET)
    const order = [...xml.matchAll(/^\s+<(type-details|revision|display-name)(?:\s[^>]*)?>/gm)].map(
      (m) => m[1]
    )
    expect(order).toEqual(['type-details', 'revision', 'display-name'])
    expect(xml).toContain(`path="${TARGET.packageName}"`)
  })
})

describe('downloadImagePackage（组合链路）', () => {
  it('全链路成功才推 100；进度序列 0<…<99→100', async () => {
    const { deps } = makeEnv()
    const percents: number[] = []
    await downloadImagePackage('/sdk', TARGET, (p) => percents.push(p), deps)
    expect(percents.at(-1)).toBe(100)
    expect(percents.filter((p) => p === 100)).toHaveLength(1)
  })

  it('sha1 失败时不落位、无 100', async () => {
    const { deps } = makeEnv({ sha1: 'c'.repeat(40) })
    const percents: number[] = []
    await expect(
      downloadImagePackage('/sdk', TARGET, (p) => percents.push(p), deps)
    ).rejects.toThrow('完整性校验失败')
    expect(percents.includes(100)).toBe(false)
  })
})

describe('verifyPackageInstall', () => {
  it('非法包名 false', async () => {
    expect(await verifyPackageInstall('/sdk', 'platform-tools', {})).toBe(false)
  })
})

describe('downloadImagePackage 取消（plan 2026-10-06-download-cancel）', () => {
  it('下载中取消：返回 canceled 不抛错、临时 zip 已清理、无 100', async () => {
    const { deps, state } = makeEnv({ chunks: new Array(50).fill(10) })
    const controller = new AbortController()
    const percents: number[] = []
    const outcome = await downloadImagePackage(
      '/sdk',
      TARGET,
      (p) => {
        percents.push(p)
        if (percents.length === 1) controller.abort() // 首个进度后取消——下一 chunk 检查点触发
      },
      deps,
      controller.signal
    )
    expect(outcome).toBe('canceled')
    expect(percents.includes(100)).toBe(false)
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })

  it('下载前取消：openUrl 不发起，返回 canceled', async () => {
    const { deps } = makeEnv()
    const controller = new AbortController()
    controller.abort()
    const outcome = await downloadImagePackage('/sdk', TARGET, () => {}, deps, controller.signal)
    expect(outcome).toBe('canceled')
  })

  it('校验阶段取消（sha1 前检查点）：不进入落位，zip 清理', async () => {
    const { deps, state } = makeEnv()
    const controller = new AbortController()
    const deps2 = {
      ...deps,
      sha1Of: async (path: string): Promise<string> => {
        controller.abort() // sha1 检查点在哈希计算前
        void path
        return TARGET.zipSha1 ?? 'a'.repeat(40)
      }
    }
    const outcome = await downloadImagePackage('/sdk', TARGET, () => {}, deps2, controller.signal)
    expect(outcome).toBe('canceled')
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })

  it('解压中取消（signal kill 解压进程）：清理解压目录，返回 canceled', async () => {
    const { deps, state } = makeEnv()
    const controller = new AbortController()
    const deps2 = {
      ...deps,
      extractZip: async (_zip: string, dir: string, signal?: AbortSignal): Promise<void> => {
        state.dirs.add(dir)
        controller.abort()
        // 模拟 execFile 被 signal kill 的行为（default 实现同口径）
        if (signal?.aborted) throw new CancelledError()
        throw new Error('unzip killed')
      }
    }
    const outcome = await downloadImagePackage('/sdk', TARGET, () => {}, deps2, controller.signal)
    expect(outcome).toBe('canceled')
    // 解压临时目录与 zip 均清理（installImageZip finally）
    expect(state.removed.some((path) => path.includes('.unzipping'))).toBe(true)
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })

  it('sha1 前取消（review P1-1 泄漏路径）：downloadImageZip 自己的 catch 清理 zip，不进 install', async () => {
    const { deps, state } = makeEnv()
    const controller = new AbortController()
    let extractCalls = 0
    const deps2 = {
      ...deps,
      // 流正常吐完最后一个 chunk 后才 abort——恰好落在 finish 后、sha1 前的检查点
      openUrl: async (url: string) => {
        void url
        return {
          stream: (async function* (): AsyncGenerator<Uint8Array> {
            for (let i = 0; i < 10; i += 1) yield new Uint8Array(10)
            controller.abort()
          })(),
          totalBytes: 100
        }
      },
      extractZip: async (...args: unknown[]) => {
        extractCalls += 1
        void args
      }
    }
    const outcome = await downloadImagePackage('/sdk', TARGET, () => {}, deps2, controller.signal)
    expect(outcome).toBe('canceled')
    // 清理由 downloadImageZip 的 catch 完成（而非 install 的 finally）——根本没进 install
    expect(extractCalls).toBe(0)
    expect(state.removed.some((path) => path.includes('.downloading.zip'))).toBe(true)
  })

  it('default extractZip 的 signal kill 真实行为：真 unzip 子进程被中断后按取消分流', async () => {
    // 造一个真 zip（含一个足够解压一会儿的条目），用 default extractZip 跑真子进程
    const { execFileSync } = await import('node:child_process')
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const staging = await mkdtemp(join(tmpdir(), 'msd-unzip-kill-'))
    try {
      // ~20MB 随机文件（不可压缩）解压需数百 ms——足够在解压中 abort
      const big = Buffer.alloc(20 * 1024 * 1024, 7)
      await writeFile(join(staging, 'big.bin'), big)
      const zipPath = join(staging, 't.zip')
      execFileSync('zip', ['-q', '-r', zipPath, 'big.bin'], { cwd: staging })
      const controller = new AbortController()
      const targetDir = join(staging, 'out')
      setTimeout(() => controller.abort(), 30)
      const { defaultDeps } = await import('../downloader')
      await expect(
        (defaultDeps.extractZip as (z: string, d: string, s?: AbortSignal) => Promise<void>)(
          zipPath,
          targetDir,
          controller.signal
        )
      ).rejects.toThrow('已取消')
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  })

  it('解压完成后、落位前取消：不进入备份-落位事务，返回 canceled', async () => {
    const { deps, state } = makeEnv()
    const controller = new AbortController()
    const deps2 = {
      ...deps,
      extractZip: async (zip: string, dir: string): Promise<void> => {
        state.dirs.add(dir)
        void zip
        controller.abort() // 解压自然完成后取消——locateContentRoot 前检查点触发
      }
    }
    const outcome = await downloadImagePackage('/sdk', TARGET, () => {}, deps2, controller.signal)
    expect(outcome).toBe('canceled')
    expect(state.moved).toHaveLength(0) // 未进入落位
  })
})
