import {
  type CreateServiceAccountInput,
  issuedApiKeySchema,
  type ServiceAccount,
  serviceAccountListSchema,
  serviceAccountProcessOptionsSchema,
  serviceAccountSchema,
} from '@river/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const serviceAccountsQueryOptions = queryOptions({
  queryKey: ['service-accounts'],
  queryFn: () => api('/service-accounts', { schema: serviceAccountListSchema }),
});

/** 可以授權給 Service Account 的 Process（發佈過的）。 */
export const serviceAccountProcessOptionsQueryOptions = queryOptions({
  queryKey: ['service-accounts', 'process-options'],
  queryFn: () =>
    api('/service-accounts/process-options', { schema: serviceAccountProcessOptionsSchema }),
});

/** 外部 API 的 OpenAPI 文件（Swagger UI）。 */
export const EXTERNAL_API_DOCS_URL = '/api/external/docs';

function useServiceAccountMutation<V, R>(mutationFn: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: serviceAccountsQueryOptions.queryKey }),
  });
}

/** 建立 Service Account 並發放 API key；回應裡的明文 key 只有這一次拿得到。 */
export function useCreateServiceAccount() {
  return useServiceAccountMutation((input: CreateServiceAccountInput) =>
    api('/service-accounts', { method: 'POST', body: input, schema: issuedApiKeySchema }),
  );
}

export function useSetServiceAccountProcesses() {
  return useServiceAccountMutation(
    ({ id, processIds }: { id: string; processIds: string[] }): Promise<ServiceAccount> =>
      api(`/service-accounts/${id}/processes`, {
        method: 'PUT',
        body: { processIds },
        schema: serviceAccountSchema,
      }),
  );
}

/** 輪替 API key：舊的 key 立即失效；回應裡的明文 key 只有這一次拿得到。 */
export function useRotateApiKey() {
  return useServiceAccountMutation((id: string) =>
    api(`/service-accounts/${id}/api-key`, { method: 'POST', schema: issuedApiKeySchema }),
  );
}
