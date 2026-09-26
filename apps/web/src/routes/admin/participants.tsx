import type { Permission } from '@river/auth';
import {
  INVITATION_EXPIRES_IN_HOURS,
  type MeResponse,
  type Participant,
  type ParticipantStatus,
} from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  KeyRound,
  Mail,
  Plus,
  RotateCcw,
  Search,
  Send,
  Upload,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { type FormEvent, Fragment, useState } from 'react';
import { Avatar, Chip, STATUS_LABELS, StatusBadge } from '@/components/people';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { deactivationImpactQueryOptions, useDeactivateParticipant } from '@/lib/admin';
import {
  participantsQueryOptions,
  rolesQueryOptions,
  useCreateParticipant,
  useResendInvitation,
  useSetManager,
  useSetPermissions,
} from '@/lib/org';
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type Preset,
  presetLabel,
  withPreset,
} from '@/lib/permissions';
import { requestNumber } from '@/lib/requests';
import { cn } from '@/lib/utils';
import { ImportParticipants } from '@/routes/admin/participant-import';

type StatusFilter = 'all' | ParticipantStatus;
const FILTERS: StatusFilter[] = ['all', 'active', 'invited', 'deactivated'];

export const NEW_PARTICIPANT = 'new';
export const IMPORT_PARTICIPANTS = 'import';

/** 人員頁：左欄清單、右欄詳情或新增表單（A「清單 + 詳情」）。`selected` 是 Participant id、`new` 或 `import`。 */
export function ParticipantsPage({
  me,
  selected,
  onSelect,
}: {
  me: MeResponse;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const people = useQuery(participantsQueryOptions);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const all = people.data ?? [];
  const q = query.trim().toLowerCase();
  const list = all.filter(
    (p) =>
      (filter === 'all' || p.status === filter) &&
      (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
  );
  const count = (f: StatusFilter) =>
    f === 'all' ? all.length : all.filter((p) => p.status === f).length;
  const current = all.find((p) => p.id === selected);

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="font-semibold text-[1.15em]">人員</h1>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => onSelect(IMPORT_PARTICIPANTS)}>
              <Upload size={14} aria-hidden /> 匯入 CSV
            </Button>
            <Button size="sm" onClick={() => onSelect(NEW_PARTICIPANT)}>
              <Plus size={14} aria-hidden /> 新增
            </Button>
          </div>
        </div>
        <div className="relative mx-3 mb-2">
          <Search
            size={15}
            aria-hidden
            className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="搜尋人員"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋姓名、email"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <fieldset className="mx-3 mb-2 flex gap-1 overflow-x-auto">
          <legend className="sr-only">依狀態篩選</legend>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'cursor-pointer whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.84em] text-muted-foreground',
                filter === f && 'border-ring bg-accent text-accent-foreground',
              )}
            >
              {f === 'all' ? '全部' : STATUS_LABELS[f]}
              <span className="ml-1 font-mono opacity-70">{count(f)}</span>
            </button>
          ))}
        </fieldset>
        <ul aria-label="人員清單" className="flex-1 overflow-auto border-t">
          {people.isPending && (
            <li className="px-3 py-8 text-center text-muted-foreground">載入中…</li>
          )}
          {people.isError && (
            <li className="px-3 py-8 text-center text-destructive">{people.error.message}</li>
          )}
          {people.isSuccess && list.length === 0 && (
            <li className="px-3 py-8 text-center text-muted-foreground">沒有符合的人。</li>
          )}
          {list.map((p) => {
            const preset = presetLabel(p.permissions);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={selected === p.id ? 'true' : undefined}
                  onClick={() => onSelect(p.id)}
                  className={cn(
                    'flex h-row w-full cursor-pointer items-center gap-2.5 border-b px-3 text-left hover:bg-muted/60',
                    selected === p.id && 'bg-accent hover:bg-accent',
                    p.status === 'deactivated' && 'opacity-55',
                  )}
                >
                  <Avatar id={p.id} name={p.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium leading-tight">{p.name}</span>
                    <span className="block truncate text-[0.82em] text-muted-foreground leading-tight">
                      {p.email}
                    </span>
                  </span>
                  {p.status === 'invited' ? (
                    <Chip tone="warn">邀請中</Chip>
                  ) : preset ? (
                    <Chip tone="primary">
                      {preset === 'Designer + Administrator' ? 'D + A' : preset}
                    </Chip>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="min-w-0 overflow-auto">
        {selected === NEW_PARTICIPANT ? (
          <CreateParticipant me={me} people={all} onOpen={onSelect} />
        ) : selected === IMPORT_PARTICIPANTS ? (
          <ImportParticipants onOpen={onSelect} />
        ) : current ? (
          <ParticipantDetail key={current.id} participant={current} people={all} me={me} />
        ) : (
          <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
              <Users size={26} aria-hidden />
            </div>
            <h2 className="font-semibold text-[1.3em]">選擇一位 Participant</h2>
            <p className="max-w-[36em] text-muted-foreground">
              在這裡設定 Manager 與 Permission，或按「新增」邀請新同仁、按「匯入 CSV」一次匯入多人。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

function ManagerSelect({
  id,
  people,
  selfId,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  people: Participant[];
  selfId?: string;
  value: string | null;
  onChange: (managerId: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-[2.6em] w-full rounded-lg border border-input bg-card px-[0.6em] text-foreground focus:border-ring focus:outline-none disabled:opacity-60"
    >
      <option value="">（沒有 Manager）</option>
      {people
        .filter((p) => p.id !== selfId && (p.status !== 'deactivated' || p.id === value))
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

// ─── 新增 ─────────────────────────────────────────────────────────────────

type InitialPreset = 'none' | Preset;

const INITIAL_PRESETS: { value: InitialPreset; label: string; hint: string }[] = [
  { value: 'none', label: '一般 Participant', hint: '只能發起申請、處理待辦' },
  { value: 'designer', label: 'Designer', hint: '編輯與發佈 Process' },
  {
    value: 'administrator',
    label: 'Administrator',
    hint: '人員、Role、Cancel、Reassign、查看全部 Request',
  },
];

function CreateParticipant({
  me,
  people,
  onOpen,
}: {
  me: MeResponse;
  people: Participant[];
  onOpen: (id: string) => void;
}) {
  const create = useCreateParticipant();
  const [managerId, setManagerId] = useState<string | null>(null);
  const [preset, setPreset] = useState<InitialPreset>('none');
  const [created, setCreated] = useState<Participant>();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate(
      {
        name: String(form.get('name')),
        email: String(form.get('email')),
        managerId,
        permissions: preset === 'none' ? [] : withPreset([], preset),
      },
      { onSuccess: setCreated },
    );
  }

  if (created) {
    return (
      <div className="mx-auto grid max-w-[560px] gap-4 px-6 py-8">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-status-approved/15 text-status-approved">
            <Send size={18} aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold text-[1.15em]">邀請信已寄出</h2>
            <p className="text-muted-foreground">{created.name} 設定密碼後就能登入。</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card text-[0.93em]">
          <dl className="grid grid-cols-[4em_1fr] gap-y-1 border-b bg-muted/60 px-3 py-2">
            <dt className="text-muted-foreground">收件人</dt>
            <dd>{created.email}</dd>
            <dt className="text-muted-foreground">主旨</dt>
            <dd>你已受邀加入 River</dd>
          </dl>
          <div className="grid gap-2 px-3 py-3">
            <p>{created.name} 你好，</p>
            <p>
              {me.name} 邀請你加入公司的 River 流程平台。請在 {INVITATION_EXPIRES_IN_HOURS}{' '}
              小時內點下方按鈕設定密碼。
            </p>
            <span className="w-fit rounded-md bg-primary px-3 py-1 text-primary-foreground">
              設定密碼
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpen(created.id)}>
            查看 {created.name}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreated(undefined);
              setManagerId(null);
              setPreset('none');
              create.reset();
            }}
          >
            <UserPlus size={14} aria-hidden /> 再新增一位
          </Button>
          {import.meta.env.DEV && (
            <a
              href="http://localhost:8025"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 text-[0.93em] text-muted-foreground hover:text-foreground"
            >
              <Mail size={14} aria-hidden /> 在 Mailpit 查看
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-[560px] gap-4 px-6 py-8">
      <div>
        <h2 className="font-semibold text-[1.3em]">新增 Participant</h2>
        <p className="text-muted-foreground">
          建立後系統會寄出邀請信，對方點信中的連結自行設定密碼。
        </p>
      </div>
      <div className="grid gap-[0.4em]">
        <Label htmlFor="new-name">姓名</Label>
        <Input id="new-name" name="name" required maxLength={100} autoComplete="off" />
      </div>
      <div className="grid gap-[0.4em]">
        <Label htmlFor="new-email">公司 Email</Label>
        <Input id="new-email" name="email" type="email" required autoComplete="off" />
      </div>
      <div className="grid gap-[0.4em]">
        <Label htmlFor="new-manager">Manager</Label>
        <ManagerSelect id="new-manager" people={people} value={managerId} onChange={setManagerId} />
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-[0.4em] font-medium text-[0.9em]">Permission</legend>
        {INITIAL_PRESETS.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2',
              preset === o.value && 'border-ring bg-accent/50',
            )}
          >
            <input
              type="radio"
              name="preset"
              checked={preset === o.value}
              onChange={() => setPreset(o.value)}
              className="mt-1 accent-primary"
            />
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-[0.86em] text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
        <p className="text-[0.84em] text-muted-foreground">
          <KeyRound size={12} aria-hidden className="mr-1 inline" />
          credential.manage 不在任何預設組合裡，建立後再單獨授予。
        </p>
      </fieldset>
      {create.isError && (
        <p role="alert" className="text-[0.9em] text-destructive">
          {create.error.message}
        </p>
      )}
      <div>
        <Button type="submit" disabled={create.isPending}>
          <Send size={14} aria-hidden /> {create.isPending ? '建立中…' : '建立並寄出邀請信'}
        </Button>
      </div>
    </form>
  );
}

// ─── 詳情 ─────────────────────────────────────────────────────────────────

function ParticipantDetail({
  participant: p,
  people,
  me,
}: {
  participant: Participant;
  people: Participant[];
  me: MeResponse;
}) {
  const canSeeRoles = me.permissions.includes('role.manage');
  const roles = useQuery({ ...rolesQueryOptions, enabled: canSeeRoles });
  const setManager = useSetManager();
  const setPermissions = useSetPermissions(me.id);
  const resend = useResendInvitation();

  const reports = people.filter((x) => x.managerId === p.id);
  const roleNames = (roles.data ?? []).filter((r) => p.roleIds.includes(r.id)).map((r) => r.name);
  const isSelf = p.id === me.id;
  const editable = p.status !== 'deactivated';

  function save(permissions: Permission[], message: string) {
    setPermissions.mutate(
      { id: p.id, permissions },
      {
        onSuccess: () => toast(message),
        onError: (error) => toast(error.message, 'error'),
      },
    );
  }

  function toggle(permission: Permission, on: boolean) {
    save(
      on ? [...p.permissions, permission] : p.permissions.filter((x) => x !== permission),
      `已${on ? '授予' : '撤銷'}「${PERMISSION_LABELS[permission].label}」`,
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-6 py-6">
      <header className="mb-6 flex items-center gap-4">
        <Avatar id={p.id} name={p.name} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[1.4em]">{p.name}</h2>
          <p className="text-muted-foreground">
            {p.email} · <StatusBadge status={p.status} />
          </p>
        </div>
      </header>

      {p.status === 'invited' && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-status-returned/40 bg-status-returned/8 px-4 py-3">
          <Mail size={16} aria-hidden className="text-status-returned" />
          <span className="flex-1">已寄出邀請信，對方還沒設定密碼。</span>
          <Button
            size="sm"
            variant="outline"
            disabled={resend.isPending}
            onClick={() =>
              resend.mutate(p.id, {
                onSuccess: () => toast(`已重寄邀請信給 ${p.email}，先前的連結已失效`),
                onError: (error) => toast(error.message, 'error'),
              })
            }
          >
            <RotateCcw size={13} aria-hidden /> 重寄邀請信
          </Button>
        </div>
      )}

      <dl className="mb-8 grid grid-cols-[7em_1fr] items-center gap-x-4 gap-y-3">
        <dt className="text-muted-foreground">
          <label htmlFor="detail-manager">Manager</label>
        </dt>
        <dd className="max-w-[280px]">
          <ManagerSelect
            id="detail-manager"
            people={people}
            selfId={p.id}
            value={p.managerId}
            disabled={!editable || setManager.isPending}
            onChange={(managerId) =>
              setManager.mutate(
                { id: p.id, managerId },
                {
                  onSuccess: () => toast('已更新 Manager'),
                  onError: (error) => toast(error.message, 'error'),
                },
              )
            }
          />
        </dd>
        <dt className="text-muted-foreground">直屬成員</dt>
        <dd className="flex flex-wrap gap-1">
          {reports.length ? (
            reports.map((r) => <Chip key={r.id}>{r.name}</Chip>)
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Role</dt>
        <dd className="flex flex-wrap gap-1">
          {!canSeeRoles ? (
            <span className="text-muted-foreground">
              {p.roleIds.length ? `${p.roleIds.length} 個 Role` : '—'}
            </span>
          ) : roleNames.length ? (
            roleNames.map((name) => (
              <Chip key={name} tone="primary">
                {name}
              </Chip>
            ))
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </dd>
      </dl>

      <section aria-labelledby="permission-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="permission-heading" className="font-semibold text-[1.1em]">
              Permission
            </h3>
            <p className="text-[0.9em] text-muted-foreground">
              變更立即生效，對方下次載入頁面時套用。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={!editable || setPermissions.isPending}
              onClick={() =>
                save(withPreset(p.permissions, 'designer'), '已套用 Designer 預設組合')
              }
            >
              套用 Designer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!editable || setPermissions.isPending}
              onClick={() =>
                save(withPreset(p.permissions, 'administrator'), '已套用 Administrator 預設組合')
              }
            >
              套用 Administrator
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!editable || setPermissions.isPending || p.permissions.length === 0}
              onClick={() =>
                // 自己的 user.manage 不能撤銷，其餘全部移除。
                save(isSelf ? ['user.manage'] : [], '已撤銷全部 Permission')
              }
            >
              全部撤銷
            </Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          {PERMISSION_GROUPS.map((group) => (
            <Fragment key={group.key}>
              <div className="flex items-center gap-1.5 border-b bg-muted/60 px-4 py-1.5 font-medium text-[0.82em] text-muted-foreground tracking-wide">
                {group.key === 'separate' && <AlertTriangle size={12} aria-hidden />}
                {group.label}
              </div>
              {group.permissions.map((permission) => {
                const locked = isSelf && permission === 'user.manage';
                return (
                  // biome-ignore lint/a11y/noLabelWithoutControl: Switch 內含 checkbox
                  <label
                    key={permission}
                    className="flex cursor-pointer items-center gap-3 border-b px-4 py-2.5 last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{PERMISSION_LABELS[permission].label}</span>
                      <code className="ml-2 font-mono text-[0.78em] text-muted-foreground">
                        {permission}
                      </code>
                      <span className="block text-[0.86em] text-muted-foreground">
                        {locked
                          ? '不能撤銷自己的這項 Permission。'
                          : PERMISSION_LABELS[permission].description}
                      </span>
                    </span>
                    <Switch
                      checked={p.permissions.includes(permission)}
                      disabled={!editable || locked || setPermissions.isPending}
                      onChange={(e) => toggle(permission, e.target.checked)}
                    />
                  </label>
                );
              })}
            </Fragment>
          ))}
        </div>
      </section>

      {editable && !isSelf && <DeactivateSection participant={p} />}
    </div>
  );
}

// ─── 停用 ─────────────────────────────────────────────────────────────────

/** 停用前先預覽影響範圍，確認後才停用；停用後 session 立即失效，資料一律不刪除。 */
function DeactivateSection({ participant: p }: { participant: Participant }) {
  const [previewing, setPreviewing] = useState(false);
  const impact = useQuery({ ...deactivationImpactQueryOptions(p.id), enabled: previewing });
  const deactivate = useDeactivateParticipant();

  return (
    <section
      aria-labelledby="deactivate-heading"
      className="mt-8 grid gap-3 rounded-xl border border-destructive/30 p-4"
    >
      <h3
        id="deactivate-heading"
        className="flex items-center gap-1.5 font-semibold text-[1.05em] text-destructive"
      >
        <UserX size={16} aria-hidden /> 停用帳號
      </h3>
      <p className="text-[0.9em] text-muted-foreground">
        離職時停用帳號：對方立即被登出且無法再登入，資料與歷程一律保留，他發起的 Request 照常進行。
      </p>
      {!previewing ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
            預覽影響範圍
          </Button>
        </div>
      ) : impact.isPending ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : impact.isError ? (
        <p className="text-destructive">{impact.error.message}</p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <h4 className="font-medium text-[0.92em]">
              直接指派給 {p.name} 的 Task（{impact.data.openTasks.length}）
            </h4>
            {impact.data.openTasks.length ? (
              <>
                <ul className="grid gap-1 text-[0.92em]">
                  {impact.data.openTasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap gap-x-1.5">
                      <span className="font-mono text-muted-foreground">
                        {requestNumber(t.request.number)}
                      </span>
                      <span>{t.request.title}</span>
                      <span className="text-muted-foreground">· {t.nodeName}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[0.86em] text-muted-foreground">
                  停用後這些 Task 會進入「待 Reassign」清單，並寄信通知 Administrator。
                </p>
              </>
            ) : (
              <p className="text-[0.9em] text-muted-foreground">沒有。</p>
            )}
          </div>
          <div className="grid gap-1.5">
            <h4 className="font-medium text-[0.92em]">
              以 {p.name} 為 Manager 的人（{impact.data.directReports.length}）
            </h4>
            {impact.data.directReports.length ? (
              <>
                <div className="flex flex-wrap gap-1">
                  {impact.data.directReports.map((r) => (
                    <Chip key={r.id}>{r.name}</Chip>
                  ))}
                </div>
                <p className="text-[0.86em] text-muted-foreground">
                  停用後，指派給他們 Manager 的步驟會改派給 Fallback Role；建議先替他們設定新的
                  Manager。
                </p>
              </>
            ) : (
              <p className="text-[0.9em] text-muted-foreground">沒有。</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={deactivate.isPending}
              onClick={() =>
                deactivate.mutate(p.id, {
                  onSuccess: () => toast(`已停用 ${p.name}`),
                  onError: (error) => toast(error.message, 'error'),
                })
              }
            >
              {deactivate.isPending ? '停用中…' : `確認停用 ${p.name}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreviewing(false)}>
              返回
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
