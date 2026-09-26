import type { RequestDetail, RequestStatus as Status } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { FormRunner } from '@/components/form-fields';
import { Avatar } from '@/components/people';
import { toast } from '@/components/toast';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  formRejection,
  isWithdrawable,
  myRequestsQueryOptions,
  requestNumber,
  requestQueryOptions,
  useResubmitRequest,
  useWithdrawRequest,
} from '@/lib/requests';
import { formatTime, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import { START_REQUEST } from '@/navigation';
import { Progress } from './request-progress';
import {
  Card,
  EmptyDetail,
  ListColumn,
  ListMessage,
  ListSearch,
  RequestContent,
  RequestHeader,
  RequestStatus,
  SegmentTabs,
  Timeline,
} from './request-view';

type Tab = 'active' | 'closed' | 'all';

/** 進行中包括等待自己修改的「已退回」；已結束包括完成與撤回。 */
const TAB_STATUSES: Record<Tab, Status[] | null> = {
  active: ['running', 'returned'],
  closed: ['completed', 'withdrawn'],
  all: null,
};
const inTab = (t: Tab, status: Status) => TAB_STATUSES[t]?.includes(status) ?? true;

/** 我的申請：左欄自己發起的 Request，右欄進度與時間軸。 */
export function RequestsPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const requests = useQuery(myRequestsQueryOptions);
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const all = requests.data ?? [];
  const q = query.trim().toLowerCase();
  const list = all.filter(
    (r) =>
      inTab(tab, r.status) &&
      (!q ||
        r.title.toLowerCase().includes(q) ||
        requestNumber(r.number).toLowerCase().includes(q)),
  );
  const count = (t: Tab) => all.filter((r) => inTab(t, r.status)).length;

  return (
    <>
      <ListColumn>
        <div className="flex items-center justify-between gap-2 p-3">
          <SegmentTabs
            label="申請狀態"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'active', label: '進行中', count: count('active') },
              { key: 'closed', label: '已結束', count: count('closed') },
              { key: 'all', label: '全部', count: count('all') },
            ]}
          />
          <Link to={START_REQUEST.to} className={buttonVariants({ size: 'sm' })}>
            <Plus size={14} aria-hidden /> 發起
          </Link>
        </div>
        <ListSearch value={query} onChange={setQuery} placeholder="搜尋編號、標題" />
        <ul aria-label="我的申請" className="flex-1 overflow-auto border-t">
          {requests.isPending && <ListMessage>載入中…</ListMessage>}
          {requests.isError && <ListMessage error>{requests.error.message}</ListMessage>}
          {requests.isSuccess && list.length === 0 && (
            <ListMessage>{all.length ? '沒有符合的申請。' : '你還沒有發起任何申請。'}</ListMessage>
          )}
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-current={selected === r.id ? 'true' : undefined}
                onClick={() => onSelect(r.id)}
                className={cn(
                  'grid w-full cursor-pointer gap-1 border-b px-3 py-2.5 text-left hover:bg-muted/60',
                  selected === r.id && 'bg-accent hover:bg-accent',
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="shrink-0 text-[0.78em] text-muted-foreground">
                    {timeAgo(r.updatedAt)}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <RequestStatus request={r} withStep />
                  <span className="shrink-0 font-mono text-[0.78em] text-muted-foreground">
                    {requestNumber(r.number)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ListColumn>
      <section className="min-w-0 overflow-auto">
        {selected ? (
          <RequestDetailView key={selected} id={selected} />
        ) : (
          <EmptyDetail
            icon={FileText}
            title="選擇一筆申請"
            text="每筆申請走到哪一步、誰在什麼時候做了什麼，都會顯示在這裡。"
          />
        )}
      </section>
    </>
  );
}

function RequestDetailView({ id }: { id: string }) {
  const request = useQuery(requestQueryOptions(id));
  if (request.isPending) return <p className="px-6 py-8 text-muted-foreground">載入中…</p>;
  if (request.isError) return <p className="px-6 py-8 text-destructive">{request.error.message}</p>;
  const r = request.data;
  return (
    <div className="mx-auto grid max-w-[760px] gap-5 px-6 py-8">
      <RequestHeader request={r} />
      {r.status === 'returned' && <ResubmitPanel request={r} />}
      <Card title="進度">
        <Progress request={r} />
      </Card>
      {r.status !== 'returned' && <RequestContent request={r} />}
      {isWithdrawable(r) && <WithdrawPanel request={r} />}
      <Card title="時間軸">
        <Timeline request={r} />
      </Card>
    </div>
  );
}

/** 被 Return：顯示意見，發起人修改標題與開始表單後重新送出，從頭開始審批。 */
function ResubmitPanel({ request }: { request: RequestDetail }) {
  const resubmit = useResubmitRequest(request.id);
  const rejected = formRejection(resubmit.error);
  const startStep = request.steps.find((s) => s.type === 'start');
  const form = request.forms.find((f) => f.id === startStep?.formId) ?? null;
  const data = request.data.find((d) => d.nodeId === startStep?.nodeId)?.data ?? {};
  const returned = request.returned;

  return (
    <section className="grid gap-4 rounded-xl border-2 border-status-returned/50 bg-card p-4">
      <header className="grid gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold text-status-returned">
          <Undo2 size={16} aria-hidden />
          已退回，請修改後重新送出
        </h2>
        {returned && (
          <div className="flex gap-2.5">
            <Avatar id={returned.by.id} name={returned.by.name} size={27} />
            <div className="grid min-w-0 flex-1 gap-1">
              <span className="text-[0.88em] text-muted-foreground">
                {returned.by.name} 在「{returned.nodeName}」Return · {formatTime(returned.at)}
              </span>
              <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2">
                {returned.comment}
              </p>
            </div>
          </div>
        )}
        <p className="text-[0.88em] text-muted-foreground">
          重新送出後會從頭開始，先前的核准全部失效，每一步都要重新處理。
        </p>
      </header>
      <FormRunner
        form={form}
        withTitle={{ placeholder: request.title }}
        initial={{ title: request.title, data }}
        submitLabel="重新送出"
        pending={resubmit.isPending}
        serverErrors={rejected?.errors}
        error={
          resubmit.isError && (
            <p role="alert" className="text-destructive">
              {resubmit.error.message}
            </p>
          )
        }
        onSubmit={({ title, data }) =>
          resubmit.mutate(
            { title, data: form ? data : undefined },
            { onSuccess: (r) => toast(`已重新送出「${r.title}」`) },
          )
        }
      />
    </section>
  );
}

/** Request 完成之前可以撤回；先展開確認，原因選填。 */
function WithdrawPanel({ request }: { request: RequestDetail }) {
  const withdraw = useWithdrawRequest(request.id);
  const [confirming, setConfirming] = useState(false);
  const [comment, setComment] = useState('');

  if (!confirming)
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 text-[0.9em] text-muted-foreground">
        <span>不再需要這筆申請？撤回後所有待處理的 Task 都會作廢，無法復原。</span>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Withdraw
        </Button>
      </div>
    );
  return (
    <section className="grid gap-3 rounded-xl border-2 border-destructive/40 bg-card p-4">
      <h2 className="font-semibold">確定要撤回「{request.title}」？</h2>
      <p className="text-[0.9em] text-muted-foreground">
        撤回後 Request 結束，所有待處理的 Task 都會作廢，無法復原。
      </p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        aria-label="撤回原因"
        placeholder="撤回原因（選填），會顯示在時間軸上"
        className="min-h-[4em] w-full resize-y rounded-lg border border-input bg-card px-[0.8em] py-[0.55em] placeholder:text-muted-foreground/80 focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_28%,transparent)] focus:outline-none"
      />
      {withdraw.isError && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
          {withdraw.error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={withdraw.isPending}
          onClick={() =>
            withdraw.mutate(comment, { onSuccess: (r) => toast(`已撤回「${r.title}」`) })
          }
        >
          {withdraw.isPending ? '撤回中…' : '確認撤回'}
        </Button>
      </div>
    </section>
  );
}
