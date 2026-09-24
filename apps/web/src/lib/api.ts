import type { z } from 'zod';

/** API 回傳非 2xx 時丟出；message 取自 Nest 的錯誤回應，可以直接顯示給使用者。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
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
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (!options.schema || res.status === 204) return undefined as T;
  return options.schema.parse(await res.json());
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
  } catch {
    // 回應不是 JSON，使用下方的預設訊息。
  }
  return `操作失敗（${res.status}），請稍後再試。`;
}
