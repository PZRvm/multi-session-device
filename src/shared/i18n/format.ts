/** 极简模板插值：`{name}` 占位替换为 params 对应值；缺参原样保留（含花括号），
 *  便于测试定位与排查。不做复数/性别等语法机器（一期边界） */
export const format = (template: string, params?: Record<string, string | number>): string => {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  )
}
