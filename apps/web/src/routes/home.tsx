import { Link } from '@tanstack/react-router';
import { Inbox, MousePointerClick, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { START_REQUEST } from '@/navigation';

type Tab = 'tasks' | 'requests';

const EMPTY_LIST: Record<Tab, string> = {
  tasks: '目前沒有待辦。',
  requests: '你還沒有發起任何申請。',
};

/** 首頁：C「控制台」版面的清單 + 詳情兩欄。資料由後續 ticket 接上，目前兩個清單都是空的。 */
export function HomePage() {
  const [tab, setTab] = useState<Tab>('tasks');

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <div role="tablist" aria-label="清單" className="inline-flex rounded-lg bg-muted p-0.5">
            <SegmentTab selected={tab === 'tasks'} onSelect={() => setTab('tasks')} count={0}>
              待辦
            </SegmentTab>
            <SegmentTab selected={tab === 'requests'} onSelect={() => setTab('requests')} count={0}>
              我的申請
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
            placeholder="搜尋編號、標題、發起人"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <div role="tabpanel" className="flex-1 overflow-auto border-border border-t">
          <p className="px-3 py-8 text-center text-[0.9em] text-muted-foreground">
            {EMPTY_LIST[tab]}
          </p>
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
          <h2 className="font-semibold text-[1.3em]">選擇一筆項目</h2>
          <p className="max-w-[36em] text-muted-foreground">
            左側清單中的待辦或申請，詳情與歷程會顯示在這裡。
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
