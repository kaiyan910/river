import {
  deactivationImpactSchema,
  myTaskSchema,
  participantSchema,
  pendingReassignListSchema,
  requestSummaryListSchema,
  requestSummarySchema,
} from '@river/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { participantsQueryOptions } from '@/lib/org';

/** 例外處理：「待 Reassign」清單、尚未結束的 Request、Cancel、Reassign、重試暫停的 Request 與停用帳號。 */

export const pendingReassignQueryOptions = queryOptions({
  queryKey: ['admin', 'pending-reassign'],
  queryFn: () => api('/tasks/pending-reassign', { schema: pendingReassignListSchema }),
});

export const activeRequestsQueryOptions = queryOptions({
  queryKey: ['admin', 'active-requests'],
  queryFn: () => api('/requests/active', { schema: requestSummaryListSchema }),
});

export const deactivationImpactQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'deactivation-impact', id],
    queryFn: () =>
      api(`/participants/${id}/deactivation-impact`, { schema: deactivationImpactSchema }),
  });

/** 例外處理改變了 Request 與 Task：重新讀取管理清單，以及自己的待辦與申請。 */
function useExceptionHandled() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin'] }),
      queryClient.invalidateQueries({ queryKey: ['requests'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    ]);
}

/** Cancel 尚未完成的 Request；原因必填。 */
export function useCancelRequest() {
  const handled = useExceptionHandled();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      api(`/requests/${id}/cancel`, {
        method: 'POST',
        body: { comment: comment.trim() },
        schema: requestSummarySchema,
      }),
    onSettled: handled,
  });
}

/** HTTP 節點重試全部失敗、Request 暫停時重試那一步。 */
export function useRetryRequest() {
  const handled = useExceptionHandled();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/requests/${id}/retry`, { method: 'POST', schema: requestSummarySchema }),
    onSettled: handled,
  });
}

/** 把 open 的 Task 改派給另一位 Participant；回傳為新的處理人建立的 Task。 */
export function useReassignTask() {
  const handled = useExceptionHandled();
  return useMutation({
    mutationFn: ({
      taskId,
      assigneeId,
      comment,
    }: {
      taskId: string;
      assigneeId: string;
      comment: string;
    }) =>
      api(`/tasks/${taskId}/reassign`, {
        method: 'POST',
        body: { assigneeId, comment: comment.trim() || undefined },
        schema: myTaskSchema,
      }),
    onSettled: handled,
  });
}

/** 停用帳號：session 立即失效，資料不刪除。 */
export function useDeactivateParticipant() {
  const handled = useExceptionHandled();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/participants/${id}/deactivate`, { method: 'POST', schema: participantSchema }),
    onSettled: () =>
      Promise.all([
        handled(),
        queryClient.invalidateQueries({ queryKey: participantsQueryOptions.queryKey }),
      ]),
  });
}
