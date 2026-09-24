import type { Role } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, Pencil, Plus, Search, Shield, UserMinus, Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Avatar, PersonPicker, StatusBadge } from '@/components/people';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  participantsQueryOptions,
  rolesQueryOptions,
  useAddRoleMember,
  useCreateRole,
  useRemoveRoleMember,
  useRenameRole,
} from '@/lib/org';
import { cn } from '@/lib/utils';

/** Role 頁：左欄 Role 清單、右欄成員（A「清單 + 詳情」）。 */
export function RolesPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const roles = useQuery(rolesQueryOptions);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const all = roles.data ?? [];
  const list = all.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = all.find((r) => r.id === selected);

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="font-semibold text-[1.15em]">Role</h1>
          <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Plus size={14} aria-hidden /> 新增
          </Button>
        </div>
        {adding && (
          <NewRoleForm
            onCreated={(role) => {
              setAdding(false);
              onSelect(role.id);
            }}
          />
        )}
        <div className="relative mx-3 mb-2">
          <Search
            size={15}
            aria-hidden
            className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="搜尋 Role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋 Role"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <ul aria-label="Role 清單" className="flex-1 overflow-auto border-t">
          {roles.isPending && (
            <li className="px-3 py-8 text-center text-muted-foreground">載入中…</li>
          )}
          {roles.isError && (
            <li className="px-3 py-8 text-center text-destructive">{roles.error.message}</li>
          )}
          {roles.isSuccess && list.length === 0 && (
            <li className="px-3 py-8 text-center text-muted-foreground">
              {all.length ? '沒有符合的 Role。' : '還沒有任何 Role。'}
            </li>
          )}
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-current={selected === r.id ? 'true' : undefined}
                onClick={() => onSelect(r.id)}
                className={cn(
                  'flex h-row w-full cursor-pointer items-center gap-2.5 border-b px-3 text-left hover:bg-muted/60',
                  selected === r.id && 'bg-accent hover:bg-accent',
                )}
              >
                <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Users size={15} aria-hidden />
                </span>
                <span className="flex-1 truncate font-medium">{r.name}</span>
                <span className="-space-x-1.5 flex">
                  {r.members.slice(0, 3).map((m) => (
                    <Avatar key={m.id} id={m.id} name={m.name} size={20} />
                  ))}
                </span>
                <span className="w-5 text-right font-mono text-[0.85em] text-muted-foreground">
                  {r.members.length}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="min-w-0 overflow-auto">
        {current ? (
          <RoleDetail key={current.id} role={current} />
        ) : (
          <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
              <Shield size={26} aria-hidden />
            </div>
            <h2 className="font-semibold text-[1.3em]">選擇一個 Role</h2>
            <p className="max-w-[36em] text-muted-foreground">
              Role 是業務上的人員集合，用來指派 Task、限制發起與查看範圍；不代表平台權限。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function NewRoleForm({ onCreated }: { onCreated: (role: Role) => void }) {
  const create = useCreateRole();
  const [name, setName] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: (role) => {
        if (!role) return;
        toast(`已建立 Role「${role.name}」`);
        onCreated(role);
      },
    });
  }

  return (
    <form onSubmit={submit} className="mx-3 mb-3 grid gap-1.5">
      <div className="flex gap-1.5">
        <Input
          aria-label="新 Role 名稱"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：財務審批人"
          required
          maxLength={100}
          className="h-[2.3em]"
        />
        <Button size="sm" type="submit" disabled={create.isPending || !name.trim()}>
          建立
        </Button>
      </div>
      {create.isError && (
        <p role="alert" className="text-[0.86em] text-destructive">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

function RoleName({ role }: { role: Role }) {
  const rename = useRenameRole();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(role.name);

  if (!editing) {
    return (
      <h2 className="font-semibold text-[1.5em]">
        <button
          type="button"
          onClick={() => {
            setValue(role.name);
            setEditing(true);
          }}
          title="點一下改名"
          className="group flex cursor-pointer items-center gap-2 text-left"
        >
          {role.name}
          <Pencil
            size={15}
            aria-label="改名"
            className="text-muted-foreground opacity-40 group-hover:opacity-100"
          />
        </button>
      </h2>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = value.trim();
    if (!name || name === role.name) return setEditing(false);
    rename.mutate(
      { id: role.id, name },
      {
        onSuccess: () => {
          toast(`已改名為「${name}」`);
          setEditing(false);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Role 名稱"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          required
          maxLength={100}
          className="max-w-[320px] font-semibold text-[1.2em]"
        />
        <Button size="icon" type="submit" aria-label="儲存名稱" disabled={rename.isPending}>
          <Check size={16} aria-hidden />
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          取消
        </Button>
      </div>
      {rename.isError && (
        <p role="alert" className="text-[0.86em] text-destructive">
          {rename.error.message}
        </p>
      )}
    </form>
  );
}

function RoleDetail({ role }: { role: Role }) {
  const people = useQuery(participantsQueryOptions);
  const add = useAddRoleMember();
  const remove = useRemoveRoleMember();

  return (
    <div className="mx-auto max-w-[720px] px-6 py-6">
      <RoleName role={role} />
      <p className="mt-1 mb-6 text-muted-foreground">{role.members.length} 位成員</p>

      <div className="mb-3 max-w-[420px]">
        <PersonPicker
          people={people.data ?? []}
          exclude={role.members.map((m) => m.id)}
          placeholder="加入成員：搜尋姓名或 email"
          disabled={!people.data}
          onPick={(p) =>
            add.mutate(
              { roleId: role.id, participantId: p.id },
              {
                onSuccess: () => toast(`已把 ${p.name} 加入「${role.name}」`),
                onError: (error) => toast(error.message, 'error'),
              },
            )
          }
        />
      </div>

      <ul aria-label="成員" className="overflow-hidden rounded-lg border bg-card">
        {role.members.length === 0 && (
          <li className="px-3 py-10 text-center text-muted-foreground">
            還沒有成員。指派給這個 Role 的 Task 會沒有人能處理。
          </li>
        )}
        {role.members.map((m) => (
          <li key={m.id} className="flex h-row items-center gap-3 border-b px-3 last:border-b-0">
            <Avatar id={m.id} name={m.name} />
            <span className="font-medium">{m.name}</span>
            <span className="flex-1 truncate text-muted-foreground">{m.email}</span>
            {m.status !== 'active' && <StatusBadge status={m.status} />}
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { roleId: role.id, participantId: m.id },
                  {
                    onSuccess: () => toast(`已把 ${m.name} 移出「${role.name}」`),
                    onError: (error) => toast(error.message, 'error'),
                  },
                )
              }
            >
              <UserMinus size={14} aria-hidden /> 移除
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
