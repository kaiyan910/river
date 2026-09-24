import { type MeResponse, meResponseSchema } from '@river/contracts';
import { queryOptions } from '@tanstack/react-query';

/** 目前登入的 Participant；未登入時為 null。 */
export const meQueryOptions = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<MeResponse | null> => {
    const res = await fetch('/api/me');
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`無法取得登入資訊（${res.status}）`);
    return meResponseSchema.parse(await res.json());
  },
  staleTime: 60_000,
});
