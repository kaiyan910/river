import type { MyTasksStatus, RequestDetail, RequestTask } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Inbox, Undo2, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { FormRunner } from '@/components/form-fields';
import { Avatar } from '@/components/people';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import {
  formRejection,
  myTasksQueryOptions,
  requestNumber,
  requestQueryOptions,
  useCompleteTask,
} from '@/lib/requests';
import { formatTime, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  Card,
  EmptyDetail,
  ListColumn,
  ListMessage,
  ListSearch,
  Progress,
  RequestContent,
  RequestHeader,
  SegmentTabs,
  Timeline,
} from './request-view';

/** 我的待辦：左欄指派給我的 Task，右欄 Request 內容、核准區與時間軸。 */
export function TasksPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const [tab, setTab] = useState<MyTasksStatus>('open');
  const [query, setQuery] = useState('');
  const open = useQuery(myTasksQueryOptions('open'));
  const done = useQuery(myTasksQueryOptions('completed'));
  const current = tab === 'open' ? open : done;
  const q = query.trim().toLowerCase();
  const all = current.data ?? [];
  const list = all.filter(
    (t) =>
      !q ||
      t.request.title.toLowerCase().includes(q) ||
      requestNumber(t.request.number).toLowerCase().includes(q),
  );
  // 選取的 Task 核准後會從「待處理」移到「已處理」；兩個清單重新讀取的空檔裡仍要保留明細，
  // 所以記住看過的 Task 屬於哪一筆 Request。
  const requestOfTask = useRef(new Map<string, string>());
  for (const t of [...(open.data ?? []), ...(done.data ?? [])])
    requestOfTask.current.set(t.id, t.request.id);
  const requestId = selected ? requestOfTask.current.get(selected) : undefined;

  return (
    <>
      <ListColumn>
        <div className="p-3">
          <SegmentTabs
            label="Task 狀態"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'open', label: '待處理', count: open.data?.length },
              { key: 'completed', label: '已處理', count: done.data?.length },
            ]}
          />
        </div>
        <ListSearch value={query} onChange={setQuery} placeholder="搜尋編號、標題" />
        <ul aria-label="我的待辦" className="flex-1 overflow-auto border-t">
          {current.isPending && <ListMessage>載入中…</ListMessage>}
          {current.isError && <ListMessage error>{current.error.message}</ListMessage>}
          {current.isSuccess && list.length === 0 && (
            <ListMessage>
              {all.length
                ? '沒有符合的 Task。'
                : tab === 'open'
                  ? '目前沒有待辦。'
                  : '還沒有處理過任何 Task。'}
            </ListMessage>
          )}
          {list.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                aria-current={selected === t.id ? 'true' : undefined}
                onClick={() => onSelect(t.id)}
                className={cn(
                  'flex w-full cursor-pointer gap-2.5 border-b px-3 py-2.5 text-left hover:bg-muted/60',
                  selected === t.id && 'bg-accent hover:bg-accent',
                )}
              >
                <Avatar id={t.request.initiator.id} name={t.request.initiator.name} size={30} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{t.request.title}</span>
                    <span className="shrink-0 text-[0.78em] text-muted-foreground">
                      {timeAgo(t.completedAt ?? t.createdAt)}
                    </span>
                  </span>
                  <span className="truncate text-[0.86em] text-muted-foreground">
                    {t.request.initiator.name} · {t.request.process.name} · {t.nodeName}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ListColumn>
      <section className="min-w-0 overflow-auto">
        {selected && requestId ? (
          <TaskDetail key={selected} taskId={selected} requestId={requestId} />
        ) : (
          <EmptyDetail
            icon={Inbox}
            title="選擇一筆待辦"
            text="Request 的內容、核准或填表，以及歷程會顯示在這裡。"
          />
        )}
      </section>
    </>
  );
}

function TaskDetail({ taskId, requestId }: { taskId: string; requestId: string }) {
  const request = useQuery(requestQueryOptions(requestId));
  // 放在這一層：已由別人處理時畫面會切成「已處理」，錯誤訊息仍然要留著。
  const complete = useCompleteTask();
  if (request.isPending) return <p className="px-6 py-8 text-muted-foreground">載入中…</p>;
  if (request.isError) return <p className="px-6 py-8 text-destructive">{request.error.message}</p>;
  const r = request.data;
  const task = r.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  return (
    <div className="mx-auto grid max-w-[760px] gap-5 px-6 py-8">
      <RequestHeader request={r} />
      <RequestContent request={r} />
      {task.status === 'open' ? (
        task.kind === 'form' ? (
          <FormTaskPanel task={task} request={r} complete={complete} />
        ) : (
          <ApprovePanel task={task} title={r.title} complete={complete} />
        )
      ) : (
        <ClosedTask task={task} request={r} error={complete.isError ? complete.error : null} />
      )}
      <Card title="進度">
        <Progress request={r} />
      </Card>
      <Card title="時間軸">
        <Timeline request={r} />
      </Card>
    </div>
  );
}

const OUTCOME_TEXT = { approved: '核准', returned: 'Return', submitted: '送出表單' } as const;

/** 已經處理或作廢的 Task；已由別人處理時，先帶上剛才送出失敗的原因。 */
function ClosedTask({
  task,
  request,
  error,
}: {
  task: RequestTask;
  request: RequestDetail;
  error: Error | null;
}) {
  const superseded = task.status === 'superseded';
  const Icon = superseded ? XCircle : task.outcome === 'returned' ? Undo2 : CheckCircle2;
  return (
    <section className="flex items-start gap-2 rounded-xl border bg-muted/60 p-4">
      <Icon
        size={18}
        aria-hidden
        className={cn(
          'mt-0.5 shrink-0',
          superseded
            ? 'text-status-closed'
            : task.outcome === 'returned'
              ? 'text-status-returned'
              : 'text-status-approved',
        )}
      />
      <span role={error ? 'alert' : undefined}>
        {error && `${error.message} `}
        {superseded ? (
          request.status === 'withdrawn' ? (
            '發起人已撤回這筆申請，這個 Task 已作廢，不需要再處理。'
          ) : (
            '這個 Task 已作廢，不需要再處理。'
          )
        ) : (
          <>
            {task.completedBy?.name} 已於 {task.completedAt && formatTime(task.completedAt)}{' '}
            {task.outcome && OUTCOME_TEXT[task.outcome]}
            {task.comment ? `：「${task.comment}」` : '。'}
          </>
        )}
      </span>
    </section>
  );
}

function YourTurn({ task }: { task: RequestTask }) {
  return (
    <header className="grid gap-0.5">
      <h2 className="font-semibold">
        輪到你：{task.nodeName}
        <span className="ml-2 font-normal text-[0.86em] text-muted-foreground">
          收到於 {timeAgo(task.createdAt)}
        </span>
      </h2>
      {task.assignee.type === 'role' && (
        <p className="text-[0.86em] text-muted-foreground">
          指派給「{task.assignee.name}」：任一成員都可以直接處理，最先送出的決定生效。
        </p>
      )}
    </header>
  );
}

/** 填表 Task：填這一步的 Form，驗證與 API 相同；送出後 Request 往下一步走。 */
function FormTaskPanel({
  task,
  request,
  complete,
}: {
  task: RequestTask;
  request: RequestDetail;
  complete: ReturnType<typeof useCompleteTask>;
}) {
  const formId = request.steps.find((s) => s.nodeId === task.nodeId)?.formId;
  const form = request.forms.find((f) => f.id === formId) ?? null;
  const rejected = formRejection(complete.error);
  return (
    <section className="grid gap-3 rounded-xl border-2 border-primary/40 bg-accent/40 p-4">
      <YourTurn task={task} />
      {form && <p className="text-[0.88em] text-muted-foreground">請填寫「{form.name}」。</p>}
      <FormRunner
        form={form}
        submitLabel="送出"
        pending={complete.isPending}
        serverErrors={rejected?.errors}
        error={
          complete.isError && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
              {complete.error.message}
            </p>
          )
        }
        onSubmit={({ data }) =>
          complete.mutate(
            { id: task.id, version: task.version, outcome: 'submitted', data },
            { onSuccess: () => toast(`已送出「${task.nodeName}」`) },
          )
        }
      />
    </section>
  );
}

function ApprovePanel({
  task,
  title,
  complete,
}: {
  task: RequestTask;
  title: string;
  complete: ReturnType<typeof useCompleteTask>;
}) {
  const [comment, setComment] = useState('');
  // Return 一定要填意見：按下 Return 時意見空白就提示，不送出。
  const [needComment, setNeedComment] = useState(false);
  const decide = (outcome: 'approved' | 'returned') => {
    if (outcome === 'returned' && !comment.trim()) {
      setNeedComment(true);
      return;
    }
    complete.mutate(
      { id: task.id, version: task.version, outcome, comment },
      {
        onSuccess: () =>
          toast(outcome === 'approved' ? `已核准「${title}」` : `已退回「${title}」給發起人`),
      },
    );
  };

  return (
    <section className="grid gap-3 rounded-xl border-2 border-primary/40 bg-accent/40 p-4">
      <YourTurn task={task} />
      <textarea
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
          if (e.target.value.trim()) setNeedComment(false);
        }}
        maxLength={2000}
        aria-label="意見"
        aria-invalid={needComment || undefined}
        aria-describedby={needComment ? 'return-comment-error' : undefined}
        placeholder="意見，會顯示在時間軸上（核准時選填，Return 時必填）"
        className="min-h-[4.5em] w-full resize-y rounded-lg border border-input bg-card px-[0.8em] py-[0.55em] placeholder:text-muted-foreground/80 focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_28%,transparent)] focus:outline-none aria-invalid:border-destructive"
      />
      {needComment && (
        <p id="return-comment-error" className="text-[0.85em] text-destructive">
          Return 時請填寫意見，讓發起人知道要修改什麼。
        </p>
      )}
      {complete.isError && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
          {complete.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={complete.isPending} onClick={() => decide('returned')}>
          <Undo2 size={15} aria-hidden /> Return
        </Button>
        <Button disabled={complete.isPending} onClick={() => decide('approved')}>
          {complete.isPending ? '送出中…' : '核准'}
        </Button>
      </div>
    </section>
  );
}
