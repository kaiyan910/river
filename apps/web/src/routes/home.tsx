import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Inbox, MousePointerClick, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { InitiatorAvatar } from '@/components/people';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  initiatorLabel,
  myRequestsQueryOptions,
  myTasksQueryOptions,
  requestNumber,
} from '@/lib/requests';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import { START_REQUEST } from '@/navigation';
import { RequestStatus } from '@/routes/portal/request-view';

type Tab = 'tasks' | 'requests';

const EMPTY_LIST: Record<Tab, string> = {
  tasks: '目前沒有待辦。',
  requests: '沒有進行中的申請。',
};

/** 首頁：待辦與進行中的申請的捷徑；點一筆會到「我的待辦」或「我的申請」看詳情。 */
export function HomePage() {
  const [tab, setTab] = useState<Tab>('tasks');
  const [query, setQuery] = useState('');
  const tasks = useQuery(myTasksQueryOptions('open'));
  const requests = useQuery(myRequestsQueryOptions);
  const running = (requests.data ?? []).filter((r) => r.status === 'running');
  const q = query.trim().toLowerCase();
  const matches = (title: string, number: number) =>
    !q || title.toLowerCase().includes(q) || requestNumber(number).toLowerCase().includes(q);
  const taskList = (tasks.data ?? []).filter((t) => matches(t.request.title, t.request.number));
  const requestList = running.filter((r) => matches(r.title, r.number));
  const empty = tab === 'tasks' ? taskList.length === 0 : requestList.length === 0;

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <div role="tablist" aria-label="清單" className="inline-flex rounded-lg bg-muted p-0.5">
            <SegmentTab
              selected={tab === 'tasks'}
              onSelect={() => setTab('tasks')}
              count={tasks.data?.length ?? 0}
            >
              待辦
            </SegmentTab>
            <SegmentTab
              selected={tab === 'requests'}
              onSelect={() => setTab('requests')}
              count={running.length}
            >
              進行中的申請
            </SegmentTab>
          </div>
          <Link to={START_REQUEST.to} className={buttonVariants({ size: 'sm' })}>
            <Plus size={14} aria-hidden /> 發起
          </Link>
        </div>
        <div className="relative mx-3 mb-2.5">
          <Search
            size={15}
            aria-hidden
            className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="搜尋"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋編號、標題"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <div role="tabpanel" className="flex-1 overflow-auto border-border border-t">
          {empty && (
            <p className="px-3 py-8 text-center text-[0.9em] text-muted-foreground">
              {q ? '沒有符合的項目。' : EMPTY_LIST[tab]}
            </p>
          )}
          <ul>
            {tab === 'tasks' &&
              taskList.map((t) => (
                <li key={t.id}>
                  <Link
                    to="/tasks"
                    search={{ id: t.id }}
                    className="flex gap-2.5 border-b px-3 py-2.5 hover:bg-muted/60"
                  >
                    <InitiatorAvatar initiator={t.request.initiator} size={30} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{t.request.title}</span>
                        <span className="shrink-0 text-[0.78em] text-muted-foreground">
                          {timeAgo(t.createdAt)}
                        </span>
                      </span>
                      <span className="truncate text-[0.86em] text-muted-foreground">
                        {initiatorLabel(t.request)} · {t.request.process.name} · {t.nodeName}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            {tab === 'requests' &&
              requestList.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/requests"
                    search={{ id: r.id }}
                    className="grid gap-1 border-b px-3 py-2.5 hover:bg-muted/60"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{r.title}</span>
                      <span className="shrink-0 text-[0.78em] text-muted-foreground">
                        {timeAgo(r.updatedAt)}
                      </span>
                    </span>
                    <RequestStatus request={r} withStep />
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </section>

      <section className="min-w-0 overflow-auto">
        <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
            {tab === 'tasks' ? (
              <Inbox size={26} aria-hidden />
            ) : (
              <MousePointerClick size={26} aria-hidden />
            )}
          </div>
          <h2 className="font-semibold text-[1.3em]">
            {tab === 'tasks' ? '處理你的待辦' : '追蹤你的申請'}
          </h2>
          <p className="max-w-[36em] text-muted-foreground">
            點左側的一筆項目，會到「{tab === 'tasks' ? '我的待辦' : '我的申請'}」看內容與歷程。
          </p>
        </div>
      </section>
    </>
  );
}

function SegmentTab({
  selected,
  onSelect,
  count,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  count: number;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'cursor-pointer rounded-md px-[0.7em] py-[0.3em] text-[0.93em] text-muted-foreground',
        selected &&
          'bg-card text-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_14%,transparent)]',
      )}
    >
      {children}
      <span className="ml-[0.35em] font-mono text-[0.85em] opacity-70">{count}</span>
    </button>
  );
}
