import type { StartableProcess } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ClipboardPen, Flag, MousePointerClick, Play } from 'lucide-react';
import { useState } from 'react';
import { FormRunner } from '@/components/form-fields';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { formRejection, startableProcessesQueryOptions, useStartRequest } from '@/lib/requests';
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
  const rejected = formRejection(start.error);

  return (
    <div className="mx-auto grid max-w-[720px] gap-5 px-6 py-8">
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
                  step.type === 'approval' || step.type === 'form'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted',
                )}
              >
                {step.type === 'start' && <Play size={11} aria-hidden />}
                {step.type === 'form' && <ClipboardPen size={11} aria-hidden />}
                {step.type === 'end' && <Flag size={11} aria-hidden />}
                {step.name}
                {step.assignee && `：${step.assignee.name}`}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="申請內容">
        <FormRunner
          key={process.id}
          form={process.startForm}
          withTitle={{ placeholder: `例如：${process.name}－10/2` }}
          submitLabel="送出申請"
          pending={start.isPending}
          serverErrors={rejected?.errors}
          error={
            start.isError && (
              <p role="alert" className="text-destructive">
                {start.error.message}
              </p>
            )
          }
          actions={
            <Button type="button" variant="ghost" onClick={onCancel}>
              取消
            </Button>
          }
          onSubmit={({ title, data }) =>
            start.mutate(
              { processId: process.id, title, data: process.startForm ? data : undefined },
              {
                onSuccess: (request) => {
                  toast(`已送出「${request.title}」`);
                  void navigate({ to: '/requests', search: { id: request.id } });
                },
              },
            )
          }
        />
      </Card>
    </div>
  );
}
