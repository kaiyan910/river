import type { Initiator, ParticipantStatus } from '@river/contracts';
import { Bot, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const HUES = [232, 155, 65, 300, 20, 190, 265, 110];

function hueOf(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return HUES[Math.abs(hash) % HUES.length] ?? HUES[0] ?? 232;
}

/** 姓名第一個字的圓形頭像；顏色由 id 決定，同一個人永遠同色。 */
export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const hue = hueOf(id);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `oklch(0.93 0.04 ${hue})`,
        color: `oklch(0.38 0.1 ${hue})`,
      }}
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** Request 發起人的頭像；Service Account 用方形的機器人圖示，和 Participant 區分。 */
export function InitiatorAvatar({ initiator, size = 28 }: { initiator: Initiator; size?: number }) {
  if (initiator.type === 'participant')
    return <Avatar id={initiator.id} name={initiator.name} size={size} />;
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
      style={{ width: size, height: size }}
    >
      <Bot size={size * 0.6} />
    </span>
  );
}

export const STATUS_LABELS: Record<ParticipantStatus, string> = {
  active: '啟用',
  invited: '邀請中',
  deactivated: '已停用',
};

const STATUS_COLORS: Record<ParticipantStatus, string> = {
  active: 'bg-status-approved',
  invited: 'bg-status-returned',
  deactivated: 'bg-status-closed',
};

export function StatusBadge({ status }: { status: ParticipantStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.86em] text-muted-foreground">
      <span className={cn('size-[7px] rounded-full', STATUS_COLORS[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function Chip({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'primary' | 'warn';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[0.8em]',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'primary' && 'bg-accent text-accent-foreground',
        tone === 'warn' && 'bg-status-returned/15 text-foreground',
      )}
    >
      {children}
    </span>
  );
}

interface Person {
  id: string;
  name: string;
  email: string;
  status: ParticipantStatus;
}

/** 輸入姓名或 email 後挑一位 Participant；已停用與 exclude 中的人不會列出。 */
export function PersonPicker({
  people,
  exclude = [],
  onPick,
  placeholder = '搜尋姓名或 email',
  disabled,
}: {
  people: Person[];
  exclude?: string[];
  onPick: (person: Person) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const q = query.trim().toLowerCase();
  const matches = q
    ? people
        .filter(
          (p) =>
            p.status !== 'deactivated' &&
            !exclude.includes(p.id) &&
            (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : [];

  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="-translate-y-1/2 absolute top-1/2 left-[0.7em] text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-controls={listId}
          className="h-[2.3em] pl-[2.1em]"
        />
      </div>
      {q && (
        <ul id={listId} className="overflow-hidden rounded-lg border bg-card">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">找不到符合的人。</li>
          )}
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(p);
                  setQuery('');
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
              >
                <Avatar id={p.id} name={p.name} size={22} />
                <span>{p.name}</span>
                <span className="truncate text-[0.86em] text-muted-foreground">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
