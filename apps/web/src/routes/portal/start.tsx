import type { StartableProcess } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Flag, MousePointerClick, Play } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { startableProcessesQueryOptions, useStartRequest } from '@/lib/requests';
import { cn } from '@/lib/utils';
import { Card, EmptyDetail, ListColumn, ListMessage, ListSearch } from './request-view';

/** 發起申請：左欄可以發起的 Process，右欄流程預覽與申請內容。 */
export function StartPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const processes = useQuery(startableProcessesQueryOptions);
  const [query, setQuery] = useState('');
  const all = processes.data ?? [];
  const list = all.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = all.find((p) => p.id === selected);

  return (
    <>
      <ListColumn>
        <div className="p-3 pb-2">
          <h1 className="font-semibold text-[1.15em]">發起申請</h1>
          <p className="text-[0.86em] text-muted-foreground">選一個流程開始。</p>
        </div>
        <ListSearch value={query} onChange={setQuery} placeholder="搜尋流程" />
        <ul aria-label="可以發起的流程" className="flex-1 overflow-auto border-t">
          {processes.isPending && <ListMessage>載入中…</ListMessage>}
          {processes.isError && <ListMessage error>{processes.error.message}</ListMessage>}
          {processes.isSuccess && list.length === 0 && (
            <ListMessage>
              {all.length ? '找不到符合的流程。' : '目前沒有可以發起的流程。'}
            </ListMessage>
          )}
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-current={selected === p.id ? 'true' : undefined}
                onClick={() => onSelect(p.id)}
                className={cn(
                  'flex h-row w-full cursor-pointer items-center justify-between gap-2 border-b px-3 text-left hover:bg-muted/60',
                  selected === p.id && 'bg-accent hover:bg-accent',
                )}
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="font-mono text-[0.78em] text-muted-foreground">v{p.version}</span>
              </button>
            </li>
          ))}
        </ul>
      </ListColumn>
      <section className="min-w-0 overflow-auto">
        {current ? (
          <StartForm key={current.id} process={current} onCancel={() => onSelect(undefined)} />
        ) : (
          <EmptyDetail
            icon={MousePointerClick}
            title="選擇一個流程"
            text="左側列出你可以發起的流程。選好之後，在這裡填寫並送出。"
          />
        )}
      </section>
    </>
  );
}

function StartForm({ process, onCancel }: { process: StartableProcess; onCancel: () => void }) {
  const start = useStartRequest();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    start.mutate(
      { processId: process.id, title: title.trim() },
      {
        onSuccess: (request) => {
          toast(`已送出「${request.title}」`);
          void navigate({ to: '/requests', search: { id: request.id } });
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-[720px] gap-5 px-6 py-8">
      <header className="grid gap-1">
        <span className="font-mono text-[0.84em] text-muted-foreground">
          Process Version {process.version}
        </span>
        <h1 className="font-semibold text-[1.5em]">{process.name}</h1>
      </header>
      <Card title="流程">
        <ol className="flex flex-wrap items-center gap-1.5 text-[0.9em]">
          {process.steps.map((step, i) => (
            <li key={step.nodeId} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5',
                  step.type === 'approval' ? 'bg-accent text-accent-foreground' : 'bg-muted',
                )}
              >
                {step.type === 'start' && <Play size={11} aria-hidden />}
                {step.type === 'end' && <Flag size={11} aria-hidden />}
                {step.name}
                {step.assignee && `：${step.assignee.name}`}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="申請內容">
        <div className="grid gap-1.5">
          <Label htmlFor="request-title">標題</Label>
          <Input
            id="request-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`例如：${process.name}－10/2`}
          />
        </div>
      </Card>
      {start.isError && (
        <p role="alert" className="text-destructive">
          {start.error.message}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={!title.trim() || start.isPending}>
          {start.isPending ? '送出中…' : '送出申請'}
        </Button>
      </div>
    </form>
  );
}
