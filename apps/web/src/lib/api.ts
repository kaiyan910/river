import type { z } from 'zod';

/** API 回傳非 2xx 時丟出；message 取自 Nest 的錯誤回應，可以直接顯示給使用者。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 解析後的錯誤回應內容；不是 JSON 時為 undefined。 */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

interface ApiOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** 有回應內容時用來驗證並轉型；204 的呼叫省略。 */
  schema?: z.ZodType<T>;
}

export async function api<T = void>(path: string, options: ApiOptions<T> = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, errorMessage(res.status, body), body);
  }
  if (!options.schema || res.status === 204) return undefined as T;
  return options.schema.parse(await res.json());
}

function errorMessage(status: number, body: unknown): string {
  const message = (body as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string') return message;
  return `操作失敗（${status}），請稍後再試。`;
}
