import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SdkRetainedRoot, SdkSourceMode, SdkSourceSnapshot } from '@shared/types'
import { getStudioDetection, runStudioDetection } from './studioDetect'
import {
  classifyRoot,
  countAvdConfigsBoundTo,
  createMigrationDeps,
  loadMigrationJournal,
  primeMigrationJournalFlag,
  toSdkMigrationView,
  treeSize
} from './sdkMigration'

/**
 * SDK 来源状态（plan 2026-10-11-sdk-source-switching）：sdk.json 是活动根的唯一
 * 事实源。托管 = 应用数据目录 AndroidSDK（PRD E 默认）；自选 = 应用全权可写根；
 * 共享 = 本机 Android Studio SDK（只读，路径由检测链核验后采纳）。
 * 持久化沿 theme/locale store 先例：boot 读入后内存先行，tmp+rename 原子落盘，
 * 损坏/缺失按缺省起步且不静默改写原文件。
 */

const STORE_VERSION = 1

export interface SdkSourceFile {
  version: number
  /** 活动来源——迁移完成才翻值，迁移中保持旧值（journal 收尾负责翻） */
  source: SdkSourceMode
  /** 自选根（绝对路径，采纳时已核验） */
  customPath: string | null
  /** 共享根（检测采纳时的已核验路径） */
  sharedPath: string | null
}

const DEFAULT_STATE: SdkSourceFile = {
  version: STORE_VERSION,
  source: 'managed',
  customPath: null,
  sharedPath: null
}

// 内存态：boot 读入后主进程不再碰磁盘读（同 locale store）
let state: SdkSourceFile = { ...DEFAULT_STATE }

/** 托管根常量（应用数据目录 AndroidSDK） */
export const managedSdkRoot = (): string => join(app.getPath('userData'), 'AndroidSDK')

function storePath(): string {
  return join(app.getPath('userData'), 'sdk.json')
}

const isSdkSourceMode = (value: unknown): value is SdkSourceMode =>
  value === 'managed' || value === 'custom' || value === 'shared-studio'

const isStoredPath = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** boot 时调用一次：读盘恢复来源态；无文件/损坏/非法字段 = 缺省起步（托管），
 *  原文件不被静默改写（下次合法写入才覆写）——容错沿 theme/locale store 先例。
 *  无论恢复结果如何都按盘面校准迁移 journal 内存标志（首次迁移崩溃时 sdk.json
 *  可能尚不存在，journal 残留仍须被守卫看见） */
export async function restoreSdkSource(): Promise<void> {
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.version === STORE_VERSION) {
      state = {
        version: STORE_VERSION,
        source: isSdkSourceMode(parsed.source) ? parsed.source : DEFAULT_STATE.source,
        customPath: isStoredPath(parsed.customPath) ? parsed.customPath : null,
        sharedPath: isStoredPath(parsed.sharedPath) ? parsed.sharedPath : null
      }
    }
  } catch {
    // 无文件/损坏：缺省起步
  }
  await primeMigrationJournalFlag(createMigrationDeps(() => app.getPath('userData')))
  // 重启进共享态：检测缓存为空则补跑一次（JBR/共享根解析依赖缓存）；失败不阻塞
  // boot——消费方经就绪门拿到指路 Studio 的可操作错误
  if (state.source === 'shared-studio') {
    try {
      await runStudioDetection()
    } catch {
      // 检测失败按缺件路径处理
    }
  }
}

/** 当前来源态（只读视图；写经 setSdkSourceState + persistSdkSourceState） */
export function getSdkSourceState(): Readonly<SdkSourceFile> {
  return state
}

/**
 * 活动根：所有 SDK 路径消费点的统一入口（emulator/devices 两域的根都从这出）。
 * 非法组合（custom/shared 但路径缺失——损坏文件或未采纳）防御性回落托管根，
 * 不让消费点拿到空路径。
 */
export function resolveSdkRoot(): string {
  if (state.source === 'custom' && state.customPath !== null) return state.customPath
  if (state.source === 'shared-studio' && state.sharedPath !== null) return state.sharedPath
  return managedSdkRoot()
}

/** 共享模式只读守卫总开关：为真时 bootstrap/包操作/许可写入全拒 */
export function isSharedReadOnly(): boolean {
  return state.source === 'shared-studio'
}

/**
 * Java 家目录（avdmanager/sdkmanager 子进程 JAVA_HOME）：托管/自选用 SDK 内置
 * JRE 布局；共享模式用 Studio JBR（检测缓存附带），未检得时回落内置布局——
 * 消费方按缺件路径报可操作错误（不在这里抛，保持纯函数）。
 */
export function javaHomeFor(root: string = resolveSdkRoot()): string {
  if (state.source === 'shared-studio') {
    const jbr = getStudioDetection()?.jbrHome
    if (jbr) return jbr
  }
  return join(root, 'jre', 'Contents', 'Home')
}

/**
 * 实际运行将用的 java 可执行文件路径——就绪门（requireSdkReady）与执行链
 * （avdmanager JAVA_HOME）共用单源。managed/custom = SDK 内置 JRE；shared =
 * Studio JBR（检测缓存附带，未检得回落内置布局，由就绪门报缺件）。
 */
export function javaBinFor(root: string = resolveSdkRoot()): string {
  return join(javaHomeFor(root), 'bin', 'java')
}

/** sdk:source-get 快照（检测读缓存不触发扫描；附迁移视图与共享态保留根清单） */
export async function getSdkSourceSnapshot(): Promise<SdkSourceSnapshot> {
  const migrationDeps = createMigrationDeps(() => app.getPath('userData'))
  const journal = await loadMigrationJournal(migrationDeps)
  // 保留根清单只在共享态计算（不变量：非共享态无保留根；全树 walk 有 IO 成本）
  const retainedRoots: SdkRetainedRoot[] = []
  if (state.source === 'shared-studio') {
    const avdHome = join(app.getPath('userData'), 'avd-home')
    for (const root of [managedSdkRoot(), state.customPath]) {
      if (root === null) continue
      if ((await classifyRoot(root, migrationDeps)) !== 'sdk') continue
      retainedRoots.push({
        root,
        bytes: await treeSize(root, migrationDeps),
        boundDevices: await countAvdConfigsBoundTo(root, avdHome, migrationDeps)
      })
    }
  }
  return {
    source: state.source,
    managedRoot: managedSdkRoot(),
    customPath: state.customPath,
    sharedPath: state.sharedPath,
    detection: getStudioDetection(),
    migration: journal === null ? null : toSdkMigrationView(journal),
    retainedRoots
  }
}

/** 内存先行（本次会话即生效）；落盘由 persistSdkSourceState 单独负责 */
export function setSdkSourceState(next: SdkSourceFile): void {
  state = { ...next, version: STORE_VERSION }
}

/** 落盘唯一写入口：tmp + rename 原子替换；失败由调用方处置。
 *  落盘串行队列（沿 theme/locale store 先例）：并发 persist 共享同一 tmp 路径会互相
 *  覆盖——排队执行且单次失败不断队列；载荷在调用时快照 */
let writeQueue: Promise<void> = Promise.resolve()

export function persistSdkSourceState(): Promise<void> {
  const payload: SdkSourceFile = { ...state }
  const task = writeQueue.then(() => writeSourceFile(payload))
  writeQueue = task.catch(() => undefined)
  return task
}

async function writeSourceFile(payload: SdkSourceFile): Promise<void> {
  const path = storePath()
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

/** 测试/恢复流程用：重置内存态为缺省（不落盘） */
export function resetSdkSourceStateForTest(): void {
  state = { ...DEFAULT_STATE }
}
