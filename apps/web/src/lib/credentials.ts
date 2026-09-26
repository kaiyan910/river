import {
  type CreateCredentialInput,
  credentialDirectorySchema,
  credentialListSchema,
  credentialSchema,
} from '@river/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Credential：秘密只能寫入，API 回傳的內容永遠不含秘密。 */

export const credentialsQueryOptions = queryOptions({
  queryKey: ['credentials'],
  queryFn: () => api('/credentials', { schema: credentialListSchema }),
});

/** Designer 在 HTTP 節點挑選 Credential 用：只有名稱與送出方式。 */
export const credentialDirectoryQueryOptions = queryOptions({
  queryKey: ['credentials', 'directory'],
  queryFn: () => api('/credentials/directory', { schema: credentialDirectorySchema }),
  staleTime: 60_000,
});

function useCredentialMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['credentials'] }),
  });
}

export function useCreateCredential() {
  return useCredentialMutation((input: CreateCredentialInput) =>
    api('/credentials', { method: 'POST', body: input, schema: credentialSchema }),
  );
}

/** 輪替秘密：HTTP 節點下一次呼叫就用新的秘密，不需要重新發佈 Process。 */
export function useRotateCredential() {
  return useCredentialMutation(({ id, secret }: { id: string; secret: string }) =>
    api(`/credentials/${id}/secret`, { method: 'PUT', body: { secret }, schema: credentialSchema }),
  );
}

export function useDeleteCredential() {
  return useCredentialMutation((id: string) => api(`/credentials/${id}`, { method: 'DELETE' }));
}
