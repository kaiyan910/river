import type { AssigneeRef, MeResponse, MyTask, RequestSummary } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Ban, ExternalLink, Globe, Repeat, RotateCw, UserX } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Avatar, Chip, InitiatorAvatar, PersonPicker } from '@/components/people';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  activeRequestsQueryOptions,
  pendingReassignQueryOptions,
  useCancelRequest,
  useReassignTask,
  useRetryRequest,
} from '@/lib/admin';
import { directoryQueryOptions } from '@/lib/org';
import { assigneeLabel, initiatorLabel, requestNumber } from '@/lib/requests';
import { formatTime, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  Card,
  EmptyDetail,
  ListColumn,
  ListMessage,
  ListSearch,
  RequestStatus,
  SegmentTabs,
} from '../portal/request-view';

type Tab = 'pending' | 'active';

/**
 * 例外處理：左欄是「待 Reassign」清單（直接指派給已停用 Participant 的 open Task）與所有進行中的 Request，
 * 右欄 Reassign Task、重試暫停的 Request（HTTP 節點失敗），或 Cancel Request。
 * `selected` 是 Task id（待 Reassign）或 Request id（進行中）。
 */
export function ReassignPage({
  me,
  selected,
  onSelect,
}: {
  me: MeResponse;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  // 只持有 request.cancel 的人沒有「待 Reassign」清單，只看得到進行中的 Request。
  const canReassign = me.permissions.includes('task.reassign');
  const pending = useQuery({ ...pendingReassignQueryOptions, enabled: canReassign });
  const active = useQuery(activeRequestsQueryOptions);
  const [tab, setTab] = useState<Tab>(() =>
    !canReassign || (selected && active.data?.some((r) => r.id === selected))
      ? 'active'
      : 'pending',
  );
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (r: Pick<RequestSummary, 'title' | 'number'>) =>
    !q || r.title.toLowerCase().includes(q) || requestNumber(r.number).toLowerCase().includes(q);

  const tasks = (pending.data ?? []).filter((t) => matches(t.request));
  const requests = (active.data ?? []).filter(matches);
  const current = tab === 'pending' ? pending : active;
  const selectedTask = pending.data?.find((t) => t.id === selected);
  const selectedRequest = active.data?.find((r) => r.id === selected);

  return (
    <>
      <ListColumn>
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="font-semibold text-[1.15em]">例外處理</h1>
        </div>
        <div className="px-3 pb-3">
          <SegmentTabs
            label="清單"
            value={tab}
            onChange={(next) => {
              setTab(next);
              onSelect(undefined);
            }}
            options={[
              ...(canReassign
                ? [{ key: 'pending' as const, label: '待 Reassign', count: pending.data?.length }]
                : []),
              { key: 'active', label: '進行中', count: active.data?.length },
            ]}
          />
        </div>
        <ListSearch value={query} onChange={setQuery} placeholder="搜尋編號、標題" />
        <ul
          aria-label={tab === 'pending' ? '待 Reassign' : '進行中的 Request'}
          className="flex-1 overflow-auto border-t"
        >
          {current.isPending && <ListMessage>載入中…</ListMessage>}
          {current.isError && <ListMessage error>{current.error.message}</ListMessage>}
          {tab === 'pending' && pending.isSuccess && tasks.length === 0 && (
            <ListMessage>
              {pending.data.length ? '沒有符合的 Task。' : '沒有待 Reassign 的 Task。'}
            </ListMessage>
          )}
          {tab === 'active' && active.isSuccess && requests.length === 0 && (
            <ListMessage>
              {active.data.length ? '沒有符合的 Request。' : '目前沒有進行中的 Request。'}
            </ListMessage>
          )}
          {tab === 'pending' &&
            tasks.map((t) => (
              <li key={t.id}>
                <ListButton selected={selected === t.id} onClick={() => onSelect(t.id)}>
                  <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <UserX size={15} aria-hidden />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{t.request.title}</span>
                      <span className="shrink-0 text-[0.78em] text-muted-foreground">
                        {timeAgo(t.createdAt)}
                      </span>
                    </span>
                    <span className="truncate text-[0.86em] text-muted-foreground">
                      {t.nodeName} · 原處理人 {t.assignee.name}（已停用）
                    </span>
                  </span>
                </ListButton>
              </li>
            ))}
          {tab === 'active' &&
            requests.map((r) => (
              <li key={r.id}>
                <ListButton selected={selected === r.id} onClick={() => onSelect(r.id)}>
                  <InitiatorAvatar initiator={r.initiator} size={30} />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{r.title}</span>
                      <span className="shrink-0 font-mono text-[0.78em] text-muted-foreground">
                        {requestNumber(r.number)}
                      </span>
                    </span>
                    <span className="truncate text-[0.86em] text-muted-foreground">
                      {initiatorLabel(r)} · {r.process.name}
                    </span>
                    <RequestStatus request={r} withStep />
                  </span>
                </ListButton>
              </li>
            ))}
        </ul>
      </ListColumn>
      <section className="min-w-0 overflow-auto">
        {selectedTask ? (
          <PendingTaskDetail key={selectedTask.id} task={selectedTask} me={me} />
        ) : selectedRequest ? (
          <ActiveRequestDetail
            key={selectedRequest.id}
            request={selectedRequest}
            me={me}
            onClosed={() => onSelect(undefined)}
          />
        ) : (
          <EmptyDetail
            icon={Repeat}
            title={tab === 'pending' ? '選擇一個待 Reassign 的 Task' : '選擇一筆進行中的 Request'}
            text={
              tab === 'pending'
                ? '處理人的帳號已停用，這些 Task 沒有人可以處理，請改派給其他人。'
                : '可以把進行中的 Task Reassign 給其他人，或 Cancel 建立錯誤的 Request。'
            }
          />
        )}
      </section>
    </>
  );
}

function ListButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer gap-2.5 border-b px-3 py-2.5 text-left hover:bg-muted/60',
        selected && 'bg-accent hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/** 持有 request.view_all 時可以打開 Request 明細（可查看的 Request 頁）。 */
function RequestTitle({
  request,
  me,
}: {
  request: MyTask['request'] | RequestSummary;
  me: MeResponse;
}) {
  return (
    <header className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[0.86em] text-muted-foreground">
        <span className="font-mono">{requestNumber(request.number)}</span>
        <span aria-hidden>·</span>
        <span>
          {request.process.name} <span className="font-mono">v{request.process.version}</span>
        </span>
      </div>
      <h2 className="font-semibold text-[1.45em]">{request.title}</h2>
      <span className="inline-flex items-center gap-1.5 text-[0.9em] text-muted-foreground">
        <InitiatorAvatar initiator={request.initiator} size={20} />
        {initiatorLabel(request)} 發起
        {me.permissions.includes('request.view_all') && (
          <Link
            to="/requests/visible"
            search={{ id: request.id }}
            className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink size={13} aria-hidden /> 查看明細與時間軸
          </Link>
        )}
      </span>
    </header>
  );
}

function PendingTaskDetail({ task, me }: { task: MyTask; me: MeResponse }) {
  return (
    <div className="mx-auto grid max-w-[720px] gap-5 px-6 py-8">
      <RequestTitle request={task.request} me={me} />
      <Card title="待 Reassign 的 Task">
        <dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-[0.95em]">
          <dt className="text-muted-foreground">步驟</dt>
          <dd>{task.nodeName}</dd>
          <dt className="text-muted-foreground">原處理人</dt>
          <dd className="flex items-center gap-1.5">
            {task.assignee.name} <Chip>已停用</Chip>
          </dd>
          <dt className="text-muted-foreground">建立時間</dt>
          <dd>{formatTime(task.createdAt)}</dd>
        </dl>
        {me.permissions.includes('task.reassign') && (
          <ReassignForm taskId={task.id} current={task.assignee} />
        )}
      </Card>
    </div>
  );
}

function ActiveRequestDetail({
  request,
  me,
  onClosed,
}: {
  request: RequestSummary;
  me: MeResponse;
  onClosed: () => void;
}) {
  const canReassign = me.permissions.includes('task.reassign');
  const [reassigning, setReassigning] = useState<string>();
  return (
    <div className="mx-auto grid max-w-[720px] gap-5 px-6 py-8">
      <RequestTitle request={request} me={me} />
      {request.paused && (
        <PausedCard
          requestId={request.id}
          paused={request.paused}
          canRetry={me.permissions.includes('request.cancel')}
        />
      )}
      <Card title="目前的 Task">
        {request.openTasks.length === 0 ? (
          <p className="text-muted-foreground">
            {request.status === 'returned'
              ? '已退回給發起人修改，目前沒有 open 的 Task。'
              : request.paused
                ? '暫停中，目前沒有 open 的 Task。'
                : '處理中，下一步馬上出現。'}
          </p>
        ) : (
          <ul className="grid gap-3">
            {request.openTasks.map((t) => (
              <li key={t.id} className="grid gap-2 rounded-lg border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{t.nodeName}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · 等待 {assigneeLabel(t.assignee)}
                    </span>
                  </span>
                  {canReassign && reassigning !== t.id && (
                    <Button size="sm" variant="outline" onClick={() => setReassigning(t.id)}>
                      <Repeat size={13} aria-hidden /> Reassign
                    </Button>
                  )}
                </div>
                {reassigning === t.id && (
                  <ReassignForm
                    taskId={t.id}
                    current={t.assignee}
                    onDone={() => setReassigning(undefined)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {me.permissions.includes('request.cancel') && (
        <CancelForm requestId={request.id} onCancelled={onClosed} />
      )}
    </div>
  );
}

/**
 * HTTP 節點重試全部失敗，Request 暫停在這一步：確認外部系統或 Credential 之後重試，或在下面 Cancel。
 * 失敗原因只有狀態碼或錯誤代碼，不含秘密或回應內容。
 */
function PausedCard({
  requestId,
  paused,
  canRetry,
}: {
  requestId: string;
  paused: NonNullable<RequestSummary['paused']>;
  canRetry: boolean;
}) {
  const retry = useRetryRequest();
  return (
    <section className="grid gap-3 rounded-xl border border-status-returned/40 p-4">
      <h2 className="flex items-center gap-1.5 font-semibold text-[0.95em] text-status-returned">
        <Globe size={14} aria-hidden /> 呼叫外部系統失敗，已暫停
      </h2>
      <dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-[0.95em]">
        <dt className="text-muted-foreground">步驟</dt>
        <dd>{paused.nodeName}</dd>
        <dt className="text-muted-foreground">原因</dt>
        <dd className="font-mono text-[0.9em]">{paused.reason || '（沒有記錄）'}</dd>
        <dt className="text-muted-foreground">暫停時間</dt>
        <dd>{formatTime(paused.at)}</dd>
      </dl>
      <p className="text-[0.9em] text-muted-foreground">
        自動重試後仍然失敗。請確認外部系統恢復、或 Credential
        已經建立或輪替之後再重試；不需要繼續時可以 Cancel。
      </p>
      {canRetry && (
        <div>
          <Button
            size="sm"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(requestId, {
                onSuccess: () => toast(`已重試「${paused.nodeName}」`),
                onError: (error) => toast(error.message, 'error'),
              })
            }
          >
            <RotateCw size={13} aria-hidden /> {retry.isPending ? '重試中…' : '重試'}
          </Button>
        </div>
      )}
    </section>
  );
}

/** 挑選新的處理人（已停用與目前的處理人不會列出）並填寫選填的原因。 */
function ReassignForm({
  taskId,
  current,
  onDone,
}: {
  taskId: string;
  current: AssigneeRef;
  onDone?: () => void;
}) {
  const directory = useQuery(directoryQueryOptions);
  const reassign = useReassignTask();
  const [assignee, setAssignee] = useState<{ id: string; name: string }>();
  const [comment, setComment] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!assignee) return;
    reassign.mutate(
      { taskId, assigneeId: assignee.id, comment },
      {
        onSuccess: (task) => {
          toast(`已把「${task.nodeName}」Reassign 給 ${assignee.name}`);
          onDone?.();
        },
        onError: (error) => toast(error.message, 'error'),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 border-t pt-3">
      <div className="grid gap-[0.4em]">
        <span className="font-medium text-[0.9em]">改派給</span>
        {assignee ? (
          <span className="flex items-center gap-2">
            <Avatar id={assignee.id} name={assignee.name} size={22} />
            {assignee.name}
            <Button type="button" size="sm" variant="ghost" onClick={() => setAssignee(undefined)}>
              更換
            </Button>
          </span>
        ) : (
          <PersonPicker
            people={directory.data ?? []}
            exclude={current.type === 'participant' ? [current.id] : []}
            onPick={setAssignee}
            disabled={directory.isPending}
          />
        )}
      </div>
      <div className="grid gap-[0.4em]">
        <Label htmlFor={`reassign-comment-${taskId}`}>原因（選填）</Label>
        <Input
          id={`reassign-comment-${taskId}`}
          value={comment}
          maxLength={2000}
          onChange={(e) => setComment(e.target.value)}
          placeholder="例如：原處理人請長假"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!assignee || reassign.isPending}>
          <Repeat size={13} aria-hidden /> {reassign.isPending ? 'Reassign 中…' : 'Reassign'}
        </Button>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            取消
          </Button>
        )}
      </div>
    </form>
  );
}

/** Cancel 必須填寫原因；原因會顯示在 Request 的時間軸。 */
function CancelForm({ requestId, onCancelled }: { requestId: string; onCancelled: () => void }) {
  const cancel = useCancelRequest();
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    cancel.mutate(
      { id: requestId, comment },
      {
        onSuccess: (r) => {
          toast(`已 Cancel ${requestNumber(r.number)}`);
          onCancelled();
        },
        onError: (error) => toast(error.message, 'error'),
      },
    );
  }

  return (
    <section className="grid gap-3 rounded-xl border border-destructive/30 p-4">
      <h2 className="flex items-center gap-1.5 font-semibold text-[0.95em] text-destructive">
        <Ban size={14} aria-hidden /> Cancel Request
      </h2>
      <p className="text-[0.9em] text-muted-foreground">
        強制終止這筆 Request：所有進行中的 Task 都會作廢，Request 不會再往下走。資料與歷程都會保留。
      </p>
      {confirming ? (
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-[0.4em]">
            <Label htmlFor={`cancel-comment-${requestId}`}>原因（必填）</Label>
            <Input
              id={`cancel-comment-${requestId}`}
              value={comment}
              required
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例如：重複建立的申請"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              variant="destructive"
              disabled={!comment.trim() || cancel.isPending}
            >
              {cancel.isPending ? 'Cancel 中…' : '確認 Cancel'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              返回
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Cancel 這筆 Request
          </Button>
        </div>
      )}
    </section>
  );
}
