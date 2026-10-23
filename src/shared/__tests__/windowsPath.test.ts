import { describe, expect, it } from 'vitest'
import {
  WINDOWS_MAX_PATH,
  WINDOWS_SDK_SUBTREE_BUDGET,
  windowsSdkRootTooLong
} from '../windowsPath'

const WARN_LINE = WINDOWS_MAX_PATH - 1 - WINDOWS_SDK_SUBTREE_BUDGET

describe('windowsSdkRootTooLong', () => {
  it('警示线 159：恰在线上不警，超线一字符即警', () => {
    expect(WARN_LINE).toBe(159)
    expect(windowsSdkRootTooLong('a'.repeat(159))).toBe(false)
    expect(windowsSdkRootTooLong('a'.repeat(160))).toBe(true)
  })

  it('空串与典型 %APPDATA% 托管根（实测前缀 70-90）不警', () => {
    expect(windowsSdkRootTooLong('')).toBe(false)
    const managed = 'C:\\Users\\pangzerui\\AppData\\Roaming\\multi-session-device\\AndroidSDK'
    expect(managed.length).toBeGreaterThan(60)
    expect(managed.length).toBeLessThan(WARN_LINE)
    expect(windowsSdkRootTooLong(managed)).toBe(false)
  })

  it('预算上界罩住 SDK 根下最深已知写入串（临时 zip 全名 ≈ 86）', () => {
    const tempSuffix =
      'system-images\\.system-images_android-35_google_apis_playstore_x86_64.downloading.zip'
    expect(tempSuffix.length).toBeLessThanOrEqual(WINDOWS_SDK_SUBTREE_BUDGET)
    const deepestDir = 'system-images\\android-35\\google_apis_playstore\\x86_64\\'
    expect(deepestDir.length).toBeLessThanOrEqual(WINDOWS_SDK_SUBTREE_BUDGET)
  })
})
