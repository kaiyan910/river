import type { Process } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { Eye, Play } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { roleDirectoryQueryOptions } from '@/lib/org';
import { useSetProcessAccess } from '@/lib/processes';

/** 標題列上的摘要：誰可以發起、誰可以查看。 */
export function accessSummary(process: Process): string {
  const names = (roles: Process['initiatorRoles']) => roles.map((r) => r.name).join('、');
  const start = process.initiatorRoles.length
    ? `${names(process.initiatorRoles)} 可發起`
    : '所有人可發起';
  return process.observerRoles.length ? `${start} · ${names(process.observerRoles)} 可查看` : start;
}

/**
 * 設定 Initiator Role 與 Observer Role。設定在 Process 上而不在草稿裡，
 * 不需要發佈、儲存後立刻生效，所以需要 process.publish。
 */
export function AccessDialog({
  process,
  canEdit,
  onClose,
}: {
  process: Process;
  canEdit: boolean;
  onClose: () => void;
}) {
  const roles = useQuery(roleDirectoryQueryOptions);
  const setAccess = useSetProcessAccess();
  const [initiators, setInitiators] = useState(() => process.initiatorRoles.map((r) => r.id));
  const [observers, setObservers] = useState(() => process.observerRoles.map((r) => r.id));

  function submit(e: FormEvent) {
    e.preventDefault();
    setAccess.mutate(
      { id: process.id, initiatorRoleIds: initiators, observerRoleIds: observers },
      {
        onSuccess: () => {
          toast('可見範圍已更新');
          onClose();
        },
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div
        role="dialog"
        aria-modal
        aria-labelledby="access-title"
        className="grid max-h-[90vh] w-full max-w-md gap-4 overflow-auto rounded-xl border bg-card p-5 shadow-xl"
      >
        <form onSubmit={submit} className="grid gap-4">
          <h2 id="access-title" className="font-semibold text-[1.1em]">
            「{process.name}」的發起與查看
          </h2>
          <p className="text-[0.88em] text-muted-foreground">
            這裡的設定不屬於任何版本，儲存後立刻生效，不需要重新發佈。
          </p>
          {roles.isPending && <p className="text-muted-foreground">載入 Role…</p>}
          {roles.isError && <p className="text-destructive">{roles.error.message}</p>}
          {roles.data && (
            <>
              <RoleChecklist
                legend={
                  <>
                    <Play size={14} aria-hidden /> Initiator Role
                  </>
                }
                hint={
                  initiators.length
                    ? '只有勾選的 Role 的成員可以發起，入口網站也只對他們列出。'
                    : '沒有勾選時，所有 Participant 都可以發起。'
                }
                roles={roles.data}
                value={initiators}
                disabled={!canEdit}
                onChange={setInitiators}
              />
              <RoleChecklist
                legend={
                  <>
                    <Eye size={14} aria-hidden /> Observer Role
                  </>
                }
                hint="勾選的 Role 的成員可以查看這個 Process 的所有 Request（唯讀）。"
                roles={roles.data}
                value={observers}
                disabled={!canEdit}
                onChange={setObservers}
              />
            </>
          )}
          {!canEdit && (
            <p className="rounded-md bg-muted p-2 text-[0.85em] text-muted-foreground">
              需要 process.publish Permission 才能修改。
            </p>
          )}
          {setAccess.isError && (
            <p role="alert" className="text-[0.88em] text-destructive">
              {setAccess.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {canEdit ? '取消' : '關閉'}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={setAccess.isPending || !roles.data}>
                {setAccess.isPending ? '儲存中…' : '儲存'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function RoleChecklist({
  legend,
  hint,
  roles,
  value,
  disabled,
  onChange,
}: {
  legend: ReactNode;
  hint: string;
  roles: { id: string; name: string; memberCount: number }[];
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 flex items-center gap-1.5 font-medium">{legend}</legend>
      {roles.length === 0 ? (
        <p className="text-[0.85em] text-muted-foreground">還沒有任何 Role。</p>
      ) : (
        <ul className="grid max-h-40 gap-0.5 overflow-auto rounded-lg border p-1.5">
          {roles.map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                <input
                  type="checkbox"
                  checked={value.includes(r.id)}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...value, r.id] : value.filter((id) => id !== r.id),
                    )
                  }
                />
                <span className="flex-1">{r.name}</span>
                <span className="text-[0.8em] text-muted-foreground">{r.memberCount} 人</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.8em] text-muted-foreground">{hint}</p>
    </fieldset>
  );
}
