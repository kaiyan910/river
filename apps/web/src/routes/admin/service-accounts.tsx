import type { IssuedApiKey, ServiceAccount } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Copy,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  EXTERNAL_API_DOCS_URL,
  serviceAccountProcessOptionsQueryOptions,
  serviceAccountsQueryOptions,
  useCreateServiceAccount,
  useRotateApiKey,
  useSetServiceAccountProcesses,
} from '@/lib/service-accounts';
import { formatTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * Service Account 頁：左欄清單、右欄授權範圍與 API key（A「清單 + 詳情」）。
 * 建立或輪替後，明文 API key 只在這個頁面的狀態裡顯示一次；換頁或選別的 Service Account 就消失，之後無法再查詢。
 */
export function ServiceAccountsPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const accounts = useQuery(serviceAccountsQueryOptions);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  /** 剛發放的明文 key；只保留在記憶體，對應到發放給哪個 Service Account。 */
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const all = accounts.data ?? [];
  const list = all.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = all.find((a) => a.id === selected);

  function select(id: string | undefined) {
    if (id !== issued?.serviceAccount.id) setIssued(null);
    onSelect(id);
  }

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="font-semibold text-[1.15em]">Service Account</h1>
          <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Plus size={14} aria-hidden /> 新增
          </Button>
        </div>
        {adding && (
          <NewServiceAccountForm
            onCreated={(result) => {
              setAdding(false);
              setIssued(result);
              onSelect(result.serviceAccount.id);
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
            aria-label="搜尋 Service Account"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋 Service Account"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <ul aria-label="Service Account 清單" className="flex-1 overflow-auto border-t">
          {accounts.isPending && (
            <li className="px-3 py-8 text-center text-muted-foreground">載入中…</li>
          )}
          {accounts.isError && (
            <li className="px-3 py-8 text-center text-destructive">{accounts.error.message}</li>
          )}
          {accounts.isSuccess && list.length === 0 && (
            <li className="px-3 py-8 text-center text-muted-foreground">
              {all.length ? '沒有符合的 Service Account。' : '還沒有任何 Service Account。'}
            </li>
          )}
          {list.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-current={selected === a.id ? 'true' : undefined}
                onClick={() => select(a.id)}
                className={cn(
                  'flex h-row w-full cursor-pointer items-center gap-2.5 border-b px-3 text-left hover:bg-muted/60',
                  selected === a.id && 'bg-accent hover:bg-accent',
                )}
              >
                <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Bot size={15} aria-hidden />
                </span>
                <span className="flex-1 truncate font-medium">{a.name}</span>
                <span className="text-[0.85em] text-muted-foreground">
                  {a.processes.length} 個 Process
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="min-w-0 overflow-auto">
        {current ? (
          <ServiceAccountDetail
            key={current.id}
            account={current}
            plaintextKey={issued?.serviceAccount.id === current.id ? issued.apiKey : null}
            onIssued={setIssued}
          />
        ) : (
          <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
              <KeyRound size={26} aria-hidden />
            </div>
            <h2 className="font-semibold text-[1.3em]">選擇一個 Service Account</h2>
            <p className="max-w-[36em] text-muted-foreground">
              外部系統以 Service Account 的 API key 透過外部 API 發起 Request，只能發起這裡授權的
              Process；可以代表某位 Participant 發起。
            </p>
            <a
              href={EXTERNAL_API_DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[0.9em] text-primary hover:underline"
            >
              外部 API 文件（OpenAPI）
              <ExternalLink size={13} aria-hidden />
            </a>
          </div>
        )}
      </section>
    </>
  );
}

function NewServiceAccountForm({ onCreated }: { onCreated: (result: IssuedApiKey) => void }) {
  const create = useCreateServiceAccount();
  const [name, setName] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { name: name.trim() },
      {
        onSuccess: (result) => {
          toast(`已建立 Service Account「${result.serviceAccount.name}」`);
          onCreated(result);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="mx-3 mb-3 grid gap-1.5">
      <div className="flex gap-1.5">
        <Input
          aria-label="新 Service Account 名稱"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：HR 系統"
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

function ServiceAccountDetail({
  account,
  plaintextKey,
  onIssued,
}: {
  account: ServiceAccount;
  plaintextKey: string | null;
  onIssued: (result: IssuedApiKey) => void;
}) {
  return (
    <div className="mx-auto grid max-w-[720px] gap-6 px-6 py-6">
      <header className="grid gap-1">
        <h2 className="font-semibold text-[1.5em]">{account.name}</h2>
        <p className="text-muted-foreground">建立於 {formatTime(account.createdAt)}</p>
      </header>
      <ApiKeySection account={account} plaintextKey={plaintextKey} onIssued={onIssued} />
      <ProcessScope account={account} />
    </div>
  );
}

function ApiKeySection({
  account,
  plaintextKey,
  onIssued,
}: {
  account: ServiceAccount;
  plaintextKey: string | null;
  onIssued: (result: IssuedApiKey) => void;
}) {
  const rotate = useRotateApiKey();
  const [confirming, setConfirming] = useState(false);

  return (
    <section aria-labelledby="api-key-heading" className="grid gap-3 rounded-xl border p-4">
      <h3 id="api-key-heading" className="flex items-center gap-1.5 font-semibold text-[1.05em]">
        <KeyRound size={16} aria-hidden /> API key
      </h3>

      {plaintextKey ? (
        <div className="grid gap-2 rounded-lg border border-status-returned/40 bg-status-returned/10 p-3">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert size={15} aria-hidden /> 請立即複製這把 API key
          </p>
          <p className="text-[0.88em] text-muted-foreground">
            平台只保存 hash，離開這個畫面後就無法再查看；遺失時只能輪替成新的 key。
          </p>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 select-all break-all rounded-md bg-card px-2 py-1.5 font-mono text-[0.85em]">
              {plaintextKey}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigator.clipboard
                  .writeText(plaintextKey)
                  .then(() => toast('已複製 API key'))
                  .catch(() => toast('無法複製，請手動選取', 'error'))
              }
            >
              <Copy size={14} aria-hidden /> 複製
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[0.92em]">
          <code className="font-mono">{account.apiKey.prefix}…</code>
          <span className="text-muted-foreground">
            {' '}
            · 發放於 {formatTime(account.apiKey.issuedAt)}
          </span>
        </p>
      )}

      <p className="text-[0.86em] text-muted-foreground">
        外部系統呼叫時帶上 <code className="font-mono">Authorization: Bearer &lt;API key&gt;</code>
        。詳見{' '}
        <a
          href={EXTERNAL_API_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          外部 API 文件
          <ExternalLink size={12} aria-hidden />
        </a>
        。
      </p>

      {!confirming ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            <RefreshCw size={14} aria-hidden /> 輪替 API key
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-[0.9em] text-destructive">
            輪替後目前的 key 立即失效，使用它的外部系統要換成新的 key 才能繼續呼叫。
          </p>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="destructive"
              disabled={rotate.isPending}
              onClick={() =>
                rotate.mutate(account.id, {
                  onSuccess: (result) => {
                    setConfirming(false);
                    toast('已發放新的 API key，舊的 key 已失效');
                    onIssued(result);
                  },
                  onError: (error) => toast(error.message, 'error'),
                })
              }
            >
              {rotate.isPending ? '輪替中…' : '確認輪替'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** 可以發起的 Process：勾選後儲存，以整份清單取代，立刻生效。 */
function ProcessScope({ account }: { account: ServiceAccount }) {
  const options = useQuery(serviceAccountProcessOptionsQueryOptions);
  const save = useSetServiceAccountProcesses();
  const saved = account.processes.map((p) => p.id);
  const [value, setValue] = useState<string[]>(saved);
  const dirty = value.length !== saved.length || value.some((id) => !saved.includes(id));

  return (
    <section aria-labelledby="scope-heading" className="grid gap-3 rounded-xl border p-4">
      <h3 id="scope-heading" className="font-semibold text-[1.05em]">
        可以發起的 Process
      </h3>
      <p className="text-[0.86em] text-muted-foreground">
        外部系統只能發起勾選的 Process。沒有帶 on_behalf_of 時發起人是這個 Service Account，指派給
        Manager 的步驟會改派給 Fallback Role。
      </p>
      {options.isPending ? (
        <p className="text-muted-foreground">載入中…</p>
      ) : options.isError ? (
        <p className="text-destructive">{options.error.message}</p>
      ) : options.data.length === 0 ? (
        <p className="text-[0.9em] text-muted-foreground">還沒有任何已發佈的 Process。</p>
      ) : (
        <ul className="grid max-h-72 gap-0.5 overflow-auto rounded-lg border p-1.5">
          {options.data.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                <input
                  type="checkbox"
                  checked={value.includes(p.id)}
                  disabled={save.isPending}
                  onChange={(e) =>
                    setValue(
                      e.target.checked ? [...value, p.id] : value.filter((id) => id !== p.id),
                    )
                  }
                />
                <span className="flex-1">{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(
              { id: account.id, processIds: value },
              {
                onSuccess: () => toast(`已更新「${account.name}」可以發起的 Process`),
                onError: (error) => toast(error.message, 'error'),
              },
            )
          }
        >
          {save.isPending ? '儲存中…' : '儲存'}
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setValue(saved)}>
            還原
          </Button>
        )}
      </div>
    </section>
  );
}
