/** 文件名段与时间戳的唯一来源——截图与录屏发布共用，规则漂移在此收敛 */

/** 设备名 → 安全文件名段：保留中文，替换路径非法字符与控制符，剥前导点，截断 60 字符 */
export const sanitizeFileSegment = (name: string): string => {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- 文件名清洗本意就是剔除控制字符
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 60)
  return cleaned.length > 0 ? cleaned : 'device'
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 本地时区 YYYYMMDD-HHmmss（截图与录屏的落盘文件名后缀） */
export const fileTimestamp = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
  `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
