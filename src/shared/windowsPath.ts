/**
 * Windows 路径长度预算（plan 2026-10-23-windows-settings-finish 设计 3）：
 * MAX_PATH 260 含结尾 NUL，可用 259；SDK 根下最深已知写入串的保守上界取 100
 * （`system-images\android-35\google_apis_playstore\x86_64\` ≈ 55 + 解包内层
 * 目录与最深文件 ≈ 45；下载临时名 ≈ 86 也在界内）。警示线 = 259 - 100 = 159，
 * 超线提示换更短路径——只提示不拦截（调研 B3 一期口径，清单注入缓行）。
 * win32 与否由调用方 gate，本模块只做算术，便于纯测；预算偏松由真机集成
 * 阶段实测回填收紧。
 */
export const WINDOWS_MAX_PATH = 260
export const WINDOWS_SDK_SUBTREE_BUDGET = 100

/** SDK 根字符数超过预算即可能撞 260 上限（分隔符各计 1，不 realpath、不归一大小写） */
export const windowsSdkRootTooLong = (root: string): boolean =>
  root.length > WINDOWS_MAX_PATH - 1 - WINDOWS_SDK_SUBTREE_BUDGET
