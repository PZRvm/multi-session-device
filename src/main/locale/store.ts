import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_LOCALE, isSettingsLocale } from '@shared/i18n'
import type { SettingsLocale } from '@shared/i18n'

const STORE_VERSION = 1

interface LocaleStoreFile {
  version: number
  locale: SettingsLocale
}

// 内存态：boot 读入后主进程不再碰磁盘读。语言无 localStorage 存量，无 theme 的 fresh 概念
let state: SettingsLocale = DEFAULT_LOCALE

function storePath(): string {
  return join(app.getPath('userData'), 'locale.json')
}

/** boot 时调用一次：读盘恢复语言态；无文件/损坏/非法字段 = 缺省起步，
 *  原文件不被静默改写（下次合法写入才覆写）——容错沿 theme store 先例 */
export async function loadLocaleState(): Promise<void> {
  let raw: string
  try {
    raw = await readFile(storePath(), 'utf8')
  } catch {
    return
  }
  let parsed: LocaleStoreFile
  try {
    parsed = JSON.parse(raw) as LocaleStoreFile
  } catch {
    state = DEFAULT_LOCALE
    return
  }
  state = isSettingsLocale(parsed.locale) ? parsed.locale : DEFAULT_LOCALE
}

/** 同步初值（locale:get-sync 的应答源）与主进程可见文案取词源：全内存，无磁盘 IO */
export function getLocaleState(): SettingsLocale {
  return state
}

/** 内存先行（本次会话即生效）；落盘由 persistLocaleState 单独负责 */
export function updateLocaleState(locale: SettingsLocale): SettingsLocale {
  state = locale
  return state
}

/** 落盘唯一写入口：tmp + rename 原子替换；失败由调用方处置。
 *  落盘串行队列（沿 theme store 先例）：并发 persist 共享同一 tmp 路径会互相
 *  覆盖——排队执行且单次失败不断队列；载荷在调用时快照 */
let writeQueue: Promise<void> = Promise.resolve()

export function persistLocaleState(): Promise<void> {
  const payload: LocaleStoreFile = { version: STORE_VERSION, locale: state }
  const task = writeQueue.then(() => writeLocaleFile(payload))
  writeQueue = task.catch(() => undefined)
  return task
}

async function writeLocaleFile(payload: LocaleStoreFile): Promise<void> {
  const path = storePath()
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
