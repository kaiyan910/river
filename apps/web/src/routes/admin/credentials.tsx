import type { Credential, CredentialScheme } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, RotateCw, Search, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  credentialsQueryOptions,
  useCreateCredential,
  useDeleteCredential,
  useRotateCredential,
} from '@/lib/credentials';
import { formatTime, timeAgo } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Card } from '../portal/request-view';

/**
 * Credential 頁（持有 credential.manage）：左欄清單、右欄詳情、輪替與刪除。
 * 秘密只能寫入：建立或輪替時輸入，存下之後就不會再顯示，API 也不會回傳。
 */
export function CredentialsPage({
  selected,
  onSelect,
}: {
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const credentials = useQuery(credentialsQueryOptions);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const all = credentials.data ?? [];
  const list = all.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = all.find((c) => c.id === selected);

  return (
    <>
      <section className="flex min-h-0 flex-col border-border bg-card md:border-r">
        <div className="flex items-center justify-between gap-2 p-3">
          <h1 className="font-semibold text-[1.15em]">Credential</h1>
          <Button size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            <Plus size={14} aria-hidden /> 新增
          </Button>
        </div>
        {adding && (
          <NewCredentialForm
            onCreated={(credential) => {
              setAdding(false);
              onSelect(credential.id);
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
            aria-label="搜尋 Credential"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋名稱"
            className="h-[2.3em] border-transparent bg-muted pl-[2.2em]"
          />
        </div>
        <ul aria-label="Credential 清單" className="flex-1 overflow-auto border-t">
          {credentials.isPending && (
            <li className="px-3 py-8 text-center text-muted-foreground">載入中…</li>
          )}
          {credentials.isError && (
            <li className="px-3 py-8 text-center text-destructive">{credentials.error.message}</li>
          )}
          {credentials.isSuccess && list.length === 0 && (
            <li className="px-3 py-8 text-center text-muted-foreground">
              {all.length ? '沒有符合的 Credential。' : '還沒有任何 Credential。'}
            </li>
          )}
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-current={selected === c.id ? 'true' : undefined}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'flex h-row w-full cursor-pointer items-center gap-2.5 border-b px-3 text-left hover:bg-muted/60',
                  selected === c.id && 'bg-accent hover:bg-accent',
                )}
              >
                <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground">
                  <KeyRound size={15} aria-hidden />
                </span>
                <span className="flex-1 truncate font-medium font-mono text-[0.95em]">
                  {c.name}
                </span>
                <span className="shrink-0 text-[0.78em] text-muted-foreground">
                  {timeAgo(c.rotatedAt)}輪替
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="min-w-0 overflow-auto">
        {current ? (
          <CredentialDetail
            key={current.id}
            credential={current}
            onDeleted={() => onSelect(undefined)}
          />
        ) : (
          <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
            <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
              <KeyRound size={26} aria-hidden />
            </div>
            <h2 className="font-semibold text-[1.3em]">選擇一個 Credential</h2>
            <p className="max-w-[36em] text-muted-foreground">
              Credential 是外部系統的 API key 或 token。HTTP 節點只以名稱引用它，秘密加密儲存，
              存下之後就不會再顯示；輪替後下一次呼叫立刻使用新的秘密，不需要重新發佈 Process。
            </p>
          </div>
        )}
      </section>
    </>
  );
}

/** 秘密的送出方式說明，例如「Authorization: Bearer」或「X-API-Key header」。 */
function schemeLabel(c: { scheme: CredentialScheme; headerName: string | null }): string {
  return c.scheme === 'bearer' ? 'Authorization: Bearer <秘密>' : `${c.headerName}: <秘密>`;
}

/** 秘密的輸入框：不回填、不自動完成，送出後清空。 */
function SecretInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      spellCheck={false}
      value={value}
      required
      maxLength={4096}
      onChange={(e) => onChange(e.target.value)}
      className="font-mono"
    />
  );
}

function NewCredentialForm({ onCreated }: { onCreated: (credential: Credential) => void }) {
  const create = useCreateCredential();
  const [name, setName] = useState('');
  const [scheme, setScheme] = useState<CredentialScheme>('bearer');
  const [headerName, setHeaderName] = useState('X-API-Key');
  const [secret, setSecret] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        scheme,
        headerName: scheme === 'header' ? headerName.trim() : null,
        secret,
      },
      {
        onSuccess: (credential) => {
          setSecret('');
          toast(`已建立 Credential「${credential.name}」`);
          onCreated(credential);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="mx-3 mb-3 grid gap-2.5 rounded-lg border p-3">
      <div className="grid gap-1">
        <Label htmlFor="credential-name">名稱</Label>
        <Input
          id="credential-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：erp-orders"
          required
          maxLength={100}
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
          title="英數字、「.」「_」「-」，並以英數字開頭"
          className="font-mono"
        />
        <p className="text-[0.8em] text-muted-foreground">
          HTTP 節點以這個名稱引用，建立後不能改。
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="credential-scheme">送出方式</Label>
        <select
          id="credential-scheme"
          value={scheme}
          onChange={(e) => setScheme(e.target.value as CredentialScheme)}
          className="h-[2.5em] w-full rounded-lg border border-input bg-card px-2"
        >
          <option value="bearer">Authorization: Bearer</option>
          <option value="header">自訂 header</option>
        </select>
      </div>
      {scheme === 'header' && (
        <div className="grid gap-1">
          <Label htmlFor="credential-header">Header 名稱</Label>
          <Input
            id="credential-header"
            value={headerName}
            onChange={(e) => setHeaderName(e.target.value)}
            required
            maxLength={100}
            className="font-mono"
          />
        </div>
      )}
      <div className="grid gap-1">
        <Label htmlFor="credential-secret">秘密</Label>
        <SecretInput id="credential-secret" value={secret} onChange={setSecret} />
        <p className="text-[0.8em] text-muted-foreground">存下之後就不會再顯示，請另外妥善保管。</p>
      </div>
      {create.isError && (
        <p role="alert" className="text-[0.86em] text-destructive">
          {create.error.message}
        </p>
      )}
      <div>
        <Button size="sm" type="submit" disabled={create.isPending || !name.trim() || !secret}>
          {create.isPending ? '建立中…' : '建立'}
        </Button>
      </div>
    </form>
  );
}

function CredentialDetail({
  credential,
  onDeleted,
}: {
  credential: Credential;
  onDeleted: () => void;
}) {
  return (
    <div className="mx-auto grid max-w-[720px] gap-5 px-6 py-8">
      <header className="grid gap-1">
        <h2 className="font-mono font-semibold text-[1.45em]">{credential.name}</h2>
        <p className="text-muted-foreground">在 HTTP 節點選擇這個名稱即可使用。</p>
      </header>
      <Card title="設定">
        <dl className="grid grid-cols-[7em_1fr] gap-y-1.5 text-[0.95em]">
          <dt className="text-muted-foreground">送出方式</dt>
          <dd className="font-mono text-[0.9em]">{schemeLabel(credential)}</dd>
          <dt className="text-muted-foreground">秘密</dt>
          <dd className="text-muted-foreground">已加密儲存，不會顯示</dd>
          <dt className="text-muted-foreground">建立</dt>
          <dd>
            {credential.createdBy.name} · {formatTime(credential.createdAt)}
          </dd>
          <dt className="text-muted-foreground">最後輪替</dt>
          <dd>
            {credential.rotatedBy.name} · {formatTime(credential.rotatedAt)}
          </dd>
        </dl>
      </Card>
      <RotateForm credential={credential} />
      <DeleteSection credential={credential} onDeleted={onDeleted} />
    </div>
  );
}

function RotateForm({ credential }: { credential: Credential }) {
  const rotate = useRotateCredential();
  const [secret, setSecret] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    rotate.mutate(
      { id: credential.id, secret },
      {
        onSuccess: () => {
          setSecret('');
          toast(`已輪替「${credential.name}」的秘密`);
        },
        onError: (error) => toast(error.message, 'error'),
      },
    );
  }

  return (
    <Card title="輪替秘密">
      <form onSubmit={submit} className="grid gap-3">
        <p className="text-[0.9em] text-muted-foreground">
          輸入新的秘密後，HTTP 節點下一次呼叫就使用它，不需要重新發佈任何 Process。
        </p>
        <div className="grid gap-1">
          <Label htmlFor={`rotate-${credential.id}`}>新的秘密</Label>
          <SecretInput id={`rotate-${credential.id}`} value={secret} onChange={setSecret} />
        </div>
        <div>
          <Button size="sm" type="submit" disabled={!secret || rotate.isPending}>
            <RotateCw size={13} aria-hidden /> {rotate.isPending ? '輪替中…' : '輪替'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeleteSection({
  credential,
  onDeleted,
}: {
  credential: Credential;
  onDeleted: () => void;
}) {
  const remove = useDeleteCredential();
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="grid gap-3 rounded-xl border border-destructive/30 p-4">
      <h2 className="flex items-center gap-1.5 font-semibold text-[0.95em] text-destructive">
        <Trash2 size={14} aria-hidden /> 刪除 Credential
      </h2>
      <p className="text-[0.9em] text-muted-foreground">
        還在引用「{credential.name}」的 HTTP 節點會呼叫失敗，Request 會暫停，直到重新建立同名的
        Credential 並由 Administrator 重試。
      </p>
      <div className="flex gap-2">
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(credential.id, {
                  onSuccess: () => {
                    toast(`已刪除 Credential「${credential.name}」`);
                    onDeleted();
                  },
                  onError: (error) => toast(error.message, 'error'),
                })
              }
            >
              {remove.isPending ? '刪除中…' : '確認刪除'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              返回
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            刪除這個 Credential
          </Button>
        )}
      </div>
    </section>
  );
}
