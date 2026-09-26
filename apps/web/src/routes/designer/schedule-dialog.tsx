import type { Process } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, UserRound } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Avatar, PersonPicker } from '@/components/people';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { directoryQueryOptions } from '@/lib/org';
import { useRemoveProcessSchedule, useSetProcessSchedule } from '@/lib/processes';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 常用的排程；選了之後填入 cron，仍然可以再修改。 */
const PRESETS = [
  { label: '每天 09:00', cron: '0 9 * * *' },
  { label: '每週一 09:00', cron: '0 9 * * 1' },
  { label: '每月 1 號 09:00', cron: '0 9 1 * *' },
];

const pad = (n: string) => n.padStart(2, '0');

/** 把常見的 cron 寫成中文（每天、每週幾、每月幾號）；其他寫法直接顯示 cron。 */
export function describeCron(cron: string): string {
  const [minute, hour, day, month, weekday] = cron.split(' ');
  const simple = (v: string | undefined) => v !== undefined && /^\d{1,2}$/.test(v);
  if (!simple(minute) || !simple(hour) || month !== '*') return `cron ${cron}`;
  const time = `${pad(hour as string)}:${pad(minute as string)}`;
  if (day === '*' && weekday === '*') return `每天 ${time}`;
  if (day === '*' && simple(weekday) && WEEKDAYS[Number(weekday) % 7])
    return `每週${WEEKDAYS[Number(weekday) % 7]} ${time}`;
  if (simple(day) && weekday === '*') return `每月 ${Number(day)} 號 ${time}`;
  return `cron ${cron}`;
}

/** 標題列上的摘要：沒有排程時為 null。 */
export function scheduleSummary(process: Process): string | null {
  return process.schedule ? `${describeCron(process.schedule.cron)} 自動發起` : null;
}

/**
 * 排程發起：時間到時以指定的發起人、Process 的目前版本自動發起一筆 Request。
 * 和 Initiator Role 一樣設定在 Process 上、立刻生效，所以需要 process.publish。
 */
export function ScheduleDialog({
  process,
  canEdit,
  onClose,
}: {
  process: Process;
  canEdit: boolean;
  onClose: () => void;
}) {
  const people = useQuery(directoryQueryOptions);
  const setSchedule = useSetProcessSchedule();
  const removeSchedule = useRemoveProcessSchedule();
  const [cron, setCron] = useState(process.schedule?.cron ?? '0 9 1 * *');
  const [initiatorId, setInitiatorId] = useState<string | null>(
    process.schedule?.initiator.id ?? null,
  );
  const cronId = useId();
  const published = process.currentVersion !== null;
  const initiator =
    people.data?.find((p) => p.id === initiatorId) ??
    (process.schedule?.initiator.id === initiatorId ? process.schedule?.initiator : undefined);
  const initiatorDeactivated =
    initiator &&
    ('status' in initiator ? initiator.status === 'deactivated' : initiator.deactivated);
  const error = setSchedule.error ?? removeSchedule.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!initiatorId) return;
    setSchedule.mutate(
      { id: process.id, cron: cron.trim(), initiatorId },
      {
        onSuccess: () => {
          toast('排程已更新');
          onClose();
        },
      },
    );
  }

  function remove() {
    removeSchedule.mutate(process.id, {
      onSuccess: () => {
        toast('排程已刪除');
        onClose();
      },
    });
  }

  const editable = canEdit && published;
  const pending = setSchedule.isPending || removeSchedule.isPending;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="schedule-title"
        className="grid max-h-[90vh] w-full max-w-md gap-4 overflow-auto rounded-xl border bg-card p-5 shadow-xl"
      >
        <form onSubmit={submit} className="grid gap-4">
          <h2 id="schedule-title" className="font-semibold text-[1.1em]">
            「{process.name}」的排程發起
          </h2>
          <p className="text-[0.88em] text-muted-foreground">
            時間到時，以指定的發起人、當時的目前版本自動發起一筆 Request。開始表單會以空白送出，
            有必填欄位時會跳過並通知 Administrator。這裡的設定儲存後立刻生效，不需要重新發佈。
          </p>
          {!published && (
            <p className="rounded-md bg-muted p-2 text-[0.85em] text-muted-foreground">
              發佈第一個版本之後才能設定排程。
            </p>
          )}

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 flex items-center gap-1.5 font-medium">
              <CalendarClock size={14} aria-hidden /> 時間
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p.cron}
                  type="button"
                  size="sm"
                  variant={cron.trim() === p.cron ? 'default' : 'outline'}
                  disabled={!editable}
                  onClick={() => setCron(p.cron)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Label htmlFor={cronId} className="mt-1 text-[0.85em]">
              cron（分 時 日 月 星期）
            </Label>
            <Input
              id={cronId}
              value={cron}
              disabled={!editable}
              onChange={(e) => setCron(e.target.value)}
              className="font-mono"
              spellCheck={false}
              required
            />
            <p className="text-[0.8em] text-muted-foreground">
              {describeCron(cron.trim().split(/\s+/).join(' '))}（台灣時間）
            </p>
          </fieldset>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 flex items-center gap-1.5 font-medium">
              <UserRound size={14} aria-hidden /> 發起人
            </legend>
            {initiatorId ? (
              <div className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
                {initiator && <Avatar id={initiator.id} name={initiator.name} size={24} />}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{initiator?.name ?? '…'}</span>
                  {initiatorDeactivated && (
                    <span className="truncate text-[0.8em] text-destructive">
                      已停用，排程會跳過，請更換
                    </span>
                  )}
                </span>
                {editable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setInitiatorId(null)}
                  >
                    更換
                  </Button>
                )}
              </div>
            ) : (
              <PersonPicker
                people={people.data ?? []}
                disabled={!editable || people.isPending}
                onPick={(p) => setInitiatorId(p.id)}
              />
            )}
            <p className="text-[0.8em] text-muted-foreground">
              Request 會出現在他的「我的申請」，指派給 Manager 的步驟交給他的 Manager。
              他必須可以發起這個 Process（Initiator Role）。
            </p>
            {people.isError && (
              <p className="text-[0.85em] text-destructive">{people.error.message}</p>
            )}
          </fieldset>

          {!canEdit && (
            <p className="rounded-md bg-muted p-2 text-[0.85em] text-muted-foreground">
              需要 process.publish Permission 才能修改。
            </p>
          )}
          {error && (
            <p role="alert" className="text-[0.88em] text-destructive">
              {error.message}
            </p>
          )}
          <div className="flex items-center gap-2">
            {editable && process.schedule && (
              <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
                刪除排程
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="ghost" onClick={onClose}>
              {editable ? '取消' : '關閉'}
            </Button>
            {editable && (
              <Button type="submit" disabled={pending || !initiatorId || !cron.trim()}>
                {setSchedule.isPending ? '儲存中…' : '儲存'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
