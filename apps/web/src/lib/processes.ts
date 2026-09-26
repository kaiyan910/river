import {
  type Process,
  type ProcessAccessInput,
  type PublishRejected,
  processListSchema,
  processSchema,
  processVersionSchema,
  publishRejectedSchema,
} from '@river/contracts';
import type { Branch, ProcessDsl } from '@river/dsl';
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

/** 從目前版本建立新草稿（複製目前版本的流程圖與 Form）。 */
export function useCreateDraft() {
  const updated = useProcessUpdated();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/processes/${id}/draft`, { method: 'POST', schema: processSchema }),
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

/** 設定 Initiator Role 與 Observer Role；立刻生效，入口網站可以發起的 Process 也要重新讀取。 */
export function useSetProcessAccess() {
  const updated = useProcessUpdated();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...access }: ProcessAccessInput & { id: string }) =>
      api(`/processes/${id}/access`, { method: 'PUT', body: access, schema: processSchema }),
    onSuccess: async (process) => {
      await updated(process);
      await queryClient.invalidateQueries({ queryKey: ['processes', 'startable'] });
    },
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

/** 條件節點出邊上顯示的條件；太長時截斷，完整內容在屬性面板。 */
export function branchLabel(branch: Branch): string {
  if (branch.type === 'default') return '預設';
  const expression = branch.expression.trim();
  if (!expression) return '（未設定條件）';
  return expression.length > 28 ? `${expression.slice(0, 27)}…` : expression;
}
