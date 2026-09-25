import type { RequestStatus as Status } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { myRequestsQueryOptions, requestNumber, requestQueryOptions } from '@/lib/requests';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import { START_REQUEST } from '@/navigation';
import {
  Card,
  EmptyDetail,
  ListColumn,
  ListMessage,
  ListSearch,
  Progress,
  RequestContent,
  RequestHeader,
  RequestStatus,
  SegmentTabs,
  Timeline,
} from './request-view';

type Tab = Status | 'all';

/** 我的申請：左欄自己發起的 Request，右欄進度與時間軸。 */
export function RequestsPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const requests = useQuery(myRequestsQueryOptions);
  const [tab, setTab] = useState<Tab>('running');
  const [query, setQuery] = useState('');
  const all = requests.data ?? [];
  const q = query.trim().toLowerCase();
  const list = all.filter(
    (r) =>
      (tab === 'all' || r.status === tab) &&
      (!q ||
        r.title.toLowerCase().includes(q) ||
        requestNumber(r.number).toLowerCase().includes(q)),
  );
  const count = (t: Tab) => all.filter((r) => t === 'all' || r.status === t).length;

  return (
    <>
      <ListColumn>
        <div className="flex items-center justify-between gap-2 p-3">
          <SegmentTabs
            label="申請狀態"
            value={tab}
            onChange={setTab}
            options={[
              { key: 'running', label: '進行中', count: count('running') },
              { key: 'completed', label: '已完成', count: count('completed') },
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
      <Card title="進度">
        <Progress request={r} />
      </Card>
      <RequestContent request={r} />
      <Card title="時間軸">
        <Timeline request={r} />
      </Card>
    </div>
  );
}
