/**
 * window.api.* 调用的统一错误包装——coding-style 错误处理约定：
 * "renderer 调 window.api.* 要处理 reject——未处理的 promise rejection 是 bug"。
 * invoke 的 reject 在这里变成可判别的 ApiResult，调用方免 try/catch，
 * 守卫抛错（如非法 options）只会以 error 字符串出现在结果里。
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export const toApiResult = async <T>(call: Promise<T>): Promise<ApiResult<T>> => {
  try {
    return { ok: true, data: await call }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
