import {
  type Process,
  type PublishRejected,
  processListSchema,
  processSchema,
  processVersionSchema,
  publishRejectedSchema,
} from '@river/contracts';
import type { ProcessDsl } from '@river/dsl';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

export const processesQueryOptions = queryOptions({
  queryKey: ['processes'],
  queryFn: () => api('/processes', { schema: processListSchema }),
});

export const processQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['processes', id],
    queryFn: () => api(`/processes/${id}`, { schema: processSchema }),
  });

/** 以回傳的最新資料更新這個 Process，並重新整理清單（名稱、目前版本、草稿時間）。 */
function useProcessUpdated() {
  const queryClient = useQueryClient();
  return async (process: Process) => {
    queryClient.setQueryData(processQueryOptions(process.id).queryKey, process);
    await queryClient.invalidateQueries({ queryKey: processesQueryOptions.queryKey, exact: true });
  };
}

export function useCreateProcess() {
  const updated = useProcessUpdated();
  return useMutation({
    mutationFn: (name: string) =>
      api('/processes', { method: 'POST', body: { name }, schema: processSchema }),
    onSuccess: updated,
  });
}

export function useRenameProcess() {
  const updated = useProcessUpdated();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api(`/processes/${id}`, { method: 'PATCH', body: { name }, schema: processSchema }),
    onSuccess: updated,
  });
}

export function useSaveDraft() {
  const updated = useProcessUpdated();
  return useMutation({
    mutationFn: ({ id, dsl }: { id: string; dsl: ProcessDsl }) =>
      api(`/processes/${id}/draft`, { method: 'PUT', body: { dsl }, schema: processSchema }),
    onSuccess: updated,
  });
}

function useRefetchProcess() {
  const queryClient = useQueryClient();
  return (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: processQueryOptions(id).queryKey }),
      queryClient.invalidateQueries({ queryKey: processesQueryOptions.queryKey, exact: true }),
    ]);
}

export function useDiscardDraft() {
  const refetch = useRefetchProcess();
  return useMutation({
    mutationFn: (id: string) => api(`/processes/${id}/draft`, { method: 'DELETE' }),
    onSuccess: (_, id) => refetch(id),
  });
}

export function usePublishProcess() {
  const refetch = useRefetchProcess();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api(`/processes/${id}/versions`, {
        method: 'POST',
        body: { note },
        schema: processVersionSchema,
      }),
    onSuccess: (_, { id }) => refetch(id),
  });
}

/** 發佈被拒絕（草稿沒有通過檢查）時 API 回傳的錯誤清單；其他錯誤回傳 null。 */
export function publishRejection(error: unknown): PublishRejected | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const parsed = publishRejectedSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}
