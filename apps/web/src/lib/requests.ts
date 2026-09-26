import {
  type FallbackReason,
  type FormRejected,
  formRejectedSchema,
  type MyTasksStatus,
  myTaskListSchema,
  type RequestDetail,
  type RequestSummary,
  type ResubmitRequestInput,
  requestDetailSchema,
  requestSummaryListSchema,
  type StepAssignee,
  startableProcessListSchema,
} from '@river/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '@/lib/api';

/** workflow 在背景往下一步走的空檔（running 但沒有 open Task）；畫面顯示「處理中」並輪詢。 */
export function isAdvancing(r: Pick<RequestSummary, 'status' | 'openTasks'>): boolean {
  return r.status === 'running' && r.openTasks.length === 0;
}

const POLL_MS = 1000;

export const startableProcessesQueryOptions = queryOptions({
  queryKey: ['processes', 'startable'],
  queryFn: () => api('/processes/startable', { schema: startableProcessListSchema }),
});

export const myRequestsQueryOptions = queryOptions({
  queryKey: ['requests', 'mine'],
  queryFn: () => api('/requests/mine', { schema: requestSummaryListSchema }),
  refetchInterval: (query) => (query.state.data?.some(isAdvancing) ? POLL_MS : false),
});

/** 看得到的所有 Request：自己發起的、經手過的、Observer Role 的 Process 的；持有 request.view_all 時是全部。 */
export const visibleRequestsQueryOptions = queryOptions({
  queryKey: ['requests', 'visible'],
  queryFn: () => api('/requests', { schema: requestSummaryListSchema }),
  refetchInterval: (query) => (query.state.data?.some(isAdvancing) ? POLL_MS : false),
});

export const requestQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['requests', id],
    queryFn: () => api(`/requests/${id}`, { schema: requestDetailSchema }),
    refetchInterval: (query) =>
      query.state.data && isAdvancing(query.state.data) ? POLL_MS : false,
  });

export const myTasksQueryOptions = (status: MyTasksStatus) =>
  queryOptions({
    queryKey: ['tasks', 'mine', status],
    queryFn: () => api(`/tasks/mine?status=${status}`, { schema: myTaskListSchema }),
  });

/** 以回傳的明細更新快取，並重新整理「我的申請」與「我的待辦」。 */
function useRequestChanged() {
  const queryClient = useQueryClient();
  return async (detail: RequestDetail) => {
    queryClient.setQueryData(requestQueryOptions(detail.id).queryKey, detail);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: myRequestsQueryOptions.queryKey }),
      queryClient.invalidateQueries({ queryKey: visibleRequestsQueryOptions.queryKey }),
      queryClient.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
    ]);
  };
}

export function useStartRequest() {
  const changed = useRequestChanged();
  return useMutation({
    mutationFn: (input: { processId: string; title: string; data?: Record<string, unknown> }) =>
      api('/requests', { method: 'POST', body: input, schema: requestDetailSchema }),
    onSuccess: changed,
  });
}

type CompleteTask =
  | { id: string; version: number; outcome: 'approved' | 'returned'; comment: string }
  | { id: string; version: number; outcome: 'submitted'; data: Record<string, unknown> };

/** 核准或 Return 審批 Task，或送出填表 Task 的 Form 資料。Return 一定要有意見。 */
export function useCompleteTask() {
  const changed = useRequestChanged();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: CompleteTask) =>
      api(`/tasks/${task.id}/complete`, {
        method: 'POST',
        body:
          task.outcome === 'submitted'
            ? { outcome: 'submitted', version: task.version, data: task.data }
            : {
                outcome: task.outcome,
                version: task.version,
                comment: task.comment.trim() || undefined,
              },
        schema: requestDetailSchema,
      }),
    onSuccess: changed,
    // 已由其他人處理或版本已經變更：重新讀取，畫面改成最新狀態。
    onError: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'mine'] }),
      ]),
  });
}

/** 修改被 Return 的 Request 後重新送出。 */
export function useResubmitRequest(id: string) {
  const changed = useRequestChanged();
  return useMutation({
    mutationFn: (input: ResubmitRequestInput) =>
      api(`/requests/${id}/resubmit`, { method: 'POST', body: input, schema: requestDetailSchema }),
    onSuccess: changed,
  });
}

/** Request 完成之前撤回。 */
export function useWithdrawRequest(id: string) {
  const changed = useRequestChanged();
  return useMutation({
    mutationFn: (comment: string) =>
      api(`/requests/${id}/withdraw`, {
        method: 'POST',
        body: { comment: comment.trim() || undefined },
        schema: requestDetailSchema,
      }),
    onSuccess: changed,
  });
}

/** 發起人還能 Withdraw 的狀態。 */
export function isWithdrawable(r: Pick<RequestSummary, 'status'>): boolean {
  return r.status === 'running' || r.status === 'returned';
}

/** Form 資料沒通過 API 驗證（422）時各欄位的錯誤；其他錯誤回傳 null。 */
export function formRejection(error: unknown): FormRejected | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const parsed = formRejectedSchema.safeParse(error.body);
  return parsed.success ? parsed.data : null;
}

/** 畫面上的指派對象：人名、「財務審批人」任一成員，或發起人的 Manager。 */
export function assigneeLabel(a: StepAssignee): string {
  if (a.type === 'manager') return '發起人的 Manager';
  return a.type === 'role' ? `「${a.name}」任一成員` : a.name;
}

/** 指派給 Manager 的 Task 改派給 Fallback Role 的原因。 */
export const FALLBACK_REASON_LABELS: Record<FallbackReason, string> = {
  no_manager: '發起人沒有 Manager',
  manager_deactivated: '發起人的 Manager 已停用',
};

/** R-000042 */
export function requestNumber(n: number): string {
  return `R-${String(n).padStart(6, '0')}`;
}
