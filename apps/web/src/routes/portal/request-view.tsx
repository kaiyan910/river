import type { RequestDetail, RequestEvent, RequestSummary } from '@river/contracts';
import { CheckCircle2, FileText, Loader2, RotateCcw, Search, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormDataView } from '@/components/form-fields';
import { Avatar } from '@/components/people';
import { Input } from '@/components/ui/input';
import { branchLabel } from '@/lib/processes';
import { assigneeLabel, FALLBACK_REASON_LABELS, isAdvancing, requestNumber } from '@/lib/requests';
import { formatTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/** 入口網站三頁（發起、我的待辦、我的申請）共用的畫面元件；版面是 A「清單 + 詳情」。 */

export function ListColumn({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
      {children}
    </section>
  );
}

export function ListSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mx-3 mb-2.5">
      <Search
        size={15}
        aria-hidden
        className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        placeholder={placeholder}
        className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
      />
    </div>
  );
}

export function SegmentTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'cursor-pointer rounded-md px-[0.7em] py-[0.3em] text-[0.93em] text-muted-foreground',
            value === o.key &&
              'bg-card text-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_14%,transparent)]',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="ml-[0.35em] font-mono text-[0.85em] opacity-70">{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ListMessage({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <li
      className={cn('px-3 py-8 text-center', error ? 'text-destructive' : 'text-muted-foreground')}
    >
      {children}
    </li>
  );
}

export function EmptyDetail({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Search;
  title: string;
  text: string;
}) {
  return (
    <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
        <Icon size={26} aria-hidden />
      </div>
      <h2 className="font-semibold text-[1.3em]">{title}</h2>
      <p className="max-w-[36em] text-muted-foreground">{text}</p>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold text-[0.95em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const FINAL_STATUS = {
  completed: { label: '已完成', dot: 'bg-status-approved' },
  withdrawn: { label: '已撤回', dot: 'bg-status-closed' },
} as const;

/**
 * 進行中：目前步驟與處理人；workflow 往下一步走的空檔顯示「處理中」。
 * 已退回：withStep 時帶上 Return 的意見。
 */
export function RequestStatus({
  request,
  withStep,
}: {
  request: Pick<RequestSummary, 'status' | 'openTasks' | 'returned'>;
  withStep?: boolean;
}) {
  if (request.status === 'completed' || request.status === 'withdrawn') {
    const { label, dot } = FINAL_STATUS[request.status];
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.86em] text-muted-foreground">
        <span className={cn('size-[7px] rounded-full', dot)} />
        {label}
      </span>
    );
  }
  if (request.status === 'returned')
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.86em] text-status-returned">
        <span className="size-[7px] shrink-0 rounded-full bg-status-returned" />
        <span className="truncate">
          已退回
          {withStep && request.returned?.comment && ` · ${request.returned.comment}`}
        </span>
      </span>
    );
  const step = request.openTasks[0];
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.86em] text-muted-foreground">
      {isAdvancing(request) ? (
        <Loader2 size={11} aria-hidden className="shrink-0 animate-spin text-status-open" />
      ) : (
        <span className="size-[7px] shrink-0 rounded-full bg-status-open" />
      )}
      <span className="truncate">
        {!withStep
          ? '進行中'
          : step
            ? `${step.nodeName} · 等待 ${request.openTasks.map((t) => assigneeLabel(t.assignee)).join('、')}`
            : '處理中'}
      </span>
    </span>
  );
}

export function RequestHeader({ request }: { request: RequestDetail }) {
  return (
    <header className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[0.86em] text-muted-foreground">
        <span className="font-mono">{requestNumber(request.number)}</span>
        <span aria-hidden>·</span>
        <span>
          {request.process.name} <span className="font-mono">v{request.process.version}</span>
        </span>
      </div>
      <h1 className="font-semibold text-[1.45em]">{request.title}</h1>
      <div className="flex flex-wrap items-center gap-3 text-[0.9em] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Avatar id={request.initiator.id} name={request.initiator.name} size={20} />
          {request.initiator.name} 發起於 {formatTime(request.createdAt)}
        </span>
        <RequestStatus request={request} withStep />
      </div>
    </header>
  );
}

/** 標題，以及依步驟分組、唯讀的 Form 資料（開始表單、各填表節點）。 */
export function RequestContent({ request }: { request: RequestDetail }) {
  return (
    <Card title="申請內容">
      <dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-[0.95em]">
        <dt className="text-muted-foreground">標題</dt>
        <dd>{request.title}</dd>
      </dl>
      {request.data.map((section) => {
        const form = request.forms.find((f) => f.id === section.formId);
        if (!form) return null;
        const step = request.steps.find((s) => s.nodeId === section.nodeId);
        return (
          <section key={section.nodeId} className="grid gap-2 border-t pt-3">
            <h3 className="flex flex-wrap items-center gap-x-1.5 text-[0.88em]">
              <FileText size={13} className="text-muted-foreground" aria-hidden />
              <span className="font-medium">
                {step?.type === 'start' ? '開始表單' : section.nodeName}
              </span>
              <span className="text-muted-foreground">
                · {form.name} · {section.submittedBy.name} 填寫於 {formatTime(section.submittedAt)}
              </span>
            </h3>
            <FormDataView form={form} data={section.data} />
          </section>
        );
      })}
    </Card>
  );
}

function describeEvent(e: RequestEvent): string {
  switch (e.type) {
    case 'request.started':
      return `${e.actor?.name} 發起申請`;
    case 'task.created': {
      const waiting = `流轉到「${e.task?.nodeName}」，等待 ${e.task && assigneeLabel(e.task.assignee)} 處理`;
      return e.fallbackReason
        ? `${waiting}（${FALLBACK_REASON_LABELS[e.fallbackReason]}，改派給 Fallback Role）`
        : waiting;
    }
    case 'task.completed':
      return e.task?.kind === 'form'
        ? `${e.actor?.name} 在「${e.task?.nodeName}」送出表單`
        : `${e.actor?.name} 在「${e.task?.nodeName}」核准`;
    case 'task.returned':
      return `${e.actor?.name} 在「${e.task?.nodeName}」Return，退回給發起人修改`;
    case 'task.superseded':
      return `「${e.task?.nodeName}」的 Task 已作廢`;
    case 'step.auto_approved':
      return `「${e.node?.name}」符合條件，自動核准`;
    case 'step.branch_chosen':
      return e.edge?.branch?.type === 'expression'
        ? `「${e.node?.name}」符合 ${branchLabel(e.edge.branch)}，流轉到「${e.edge.target.name}」`
        : `「${e.node?.name}」沒有符合的條件，走預設分支到「${e.edge?.target.name}」`;
    case 'step.email_sent':
      return `「${e.node?.name}」寄出 Email 通知`;
    case 'request.resubmitted':
      return `${e.actor?.name} 修改後重新送出，從頭開始審批`;
    case 'request.withdrawn':
      return `${e.actor?.name} 撤回申請`;
    case 'request.completed':
      return '申請完成';
  }
}

/** 沒有 actor 的系統事件用小圓點；完成、撤回用圖示。 */
function SystemEventIcon({ type }: { type: RequestEvent['type'] }) {
  if (type === 'request.completed') return <CheckCircle2 size={14} aria-hidden />;
  if (type === 'task.superseded') return <XCircle size={14} aria-hidden />;
  return <span className="size-1.5 rounded-full bg-current" />;
}

const EVENT_TONE: Partial<Record<RequestEvent['type'], string>> = {
  'task.returned': 'text-status-returned',
  'request.resubmitted': 'text-status-open',
};

/** 時間軸：逐列顯示 request_events。 */
export function Timeline({ request }: { request: RequestDetail }) {
  return (
    <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-border">
      {request.events.map((e) => (
        <li key={e.id} className="relative flex gap-3">
          <span className="z-[1] mt-0.5">
            {e.actor ? (
              <Avatar id={e.actor.id} name={e.actor.name} size={27} />
            ) : (
              <span
                className={cn(
                  'grid size-[27px] place-items-center rounded-full border bg-card text-muted-foreground',
                  e.type === 'request.completed' && 'border-status-approved text-status-approved',
                )}
              >
                <SystemEventIcon type={e.type} />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span
                className={cn(
                  e.actor ? 'font-medium' : 'text-muted-foreground',
                  EVENT_TONE[e.type],
                )}
              >
                {e.type === 'request.resubmitted' && (
                  <RotateCcw size={13} aria-hidden className="mr-1 inline align-[-1px]" />
                )}
                {describeEvent(e)}
              </span>
              <time dateTime={e.at} className="font-mono text-[0.8em] text-muted-foreground">
                {formatTime(e.at)}
              </time>
            </div>
            {e.comment && (
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-[0.93em]">
                {e.comment}
              </p>
            )}
          </div>
        </li>
      ))}
      {isAdvancing(request) && (
        <li className="relative flex gap-3 text-muted-foreground">
          <span className="z-[1] grid size-[27px] place-items-center rounded-full border bg-card">
            <Loader2 size={13} aria-hidden className="animate-spin" />
          </span>
          <span className="mt-1">處理中，下一步馬上出現…</span>
        </li>
      )}
    </ol>
  );
}
