import { INVITATION_EXPIRES_IN_HOURS } from '@river/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck, Clock } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { invitationQueryOptions } from '@/lib/org';

const MIN_PASSWORD_LENGTH = 12;

/** 邀請信連結的落地頁：員工自行設定密碼。沿用登入頁 A「清流」的分割式版面。 */
export function InvitePage({ token }: { token: string }) {
  const invitation = useQuery(invitationQueryOptions(token));
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    if (password.length < MIN_PASSWORD_LENGTH) {
      return setError(`密碼至少要 ${MIN_PASSWORD_LENGTH} 個字元。`);
    }
    if (password !== String(form.get('confirm'))) return setError('兩次輸入的密碼不一樣。');

    setPending(true);
    setError(undefined);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (error) {
      setError(
        error.code === 'INVALID_TOKEN'
          ? '邀請連結已失效，請聯絡 Administrator 重寄邀請信。'
          : '設定密碼失敗，請稍後再試。',
      );
      return;
    }
    setDone(true);
  }

  const expired = invitation.error instanceof ApiError && invitation.error.status === 404;

  return (
    <div className="grid min-h-screen min-[820px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between gap-10 bg-brand px-12 py-10 text-brand-foreground min-[820px]:flex">
        <div className="flex items-center gap-2 font-bold text-[1.1em]">
          <Logo /> River
        </div>
        <h2 className="font-semibold text-[2em] tracking-[-0.02em]">
          歡迎加入。
          <br />
          設定密碼後就能開始使用。
        </h2>
        <p className="text-[0.86em] opacity-65">公司內部系統 · 僅限員工使用</p>
      </aside>

      <main className="grid place-items-center px-4 pt-8 pb-16">
        <div className="w-full max-w-[360px]">
          <div className="mb-7 flex items-center gap-2 font-bold text-[1.1em] text-primary min-[820px]:hidden">
            <Logo /> <span className="text-foreground">River</span>
          </div>

          {invitation.isPending ? (
            <p className="text-muted-foreground">確認邀請連結中…</p>
          ) : done ? (
            <>
              <CircleCheck size={32} aria-hidden className="mb-3 text-status-approved" />
              <h1 className="mb-2 font-semibold text-[1.6em]">密碼已設定</h1>
              <p className="mb-6 text-muted-foreground">
                用 {invitation.data?.email} 和剛設定的密碼登入。
              </p>
              <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
                前往登入
              </Link>
            </>
          ) : invitation.isError ? (
            <>
              <Clock size={32} aria-hidden className="mb-3 text-status-returned" />
              <h1 className="mb-2 font-semibold text-[1.6em]">
                {expired ? '邀請連結已失效' : '無法確認邀請連結'}
              </h1>
              <p className="text-muted-foreground">
                {expired
                  ? `連結超過 ${INVITATION_EXPIRES_IN_HOURS} 小時、已經使用過，或已經重寄過新的邀請信。請聯絡 Administrator 重寄邀請信。`
                  : '請稍後重新整理這個頁面。'}
              </p>
            </>
          ) : (
            <form onSubmit={onSubmit}>
              <h1 className="mb-[0.3em] font-semibold text-[1.7em]">設定密碼</h1>
              <p className="mb-[1.8em] text-muted-foreground">
                {invitation.data.name} 你好，設定密碼後就能用公司 email 登入 River。
              </p>
              <div className="mb-[1.1em] grid gap-[0.4em]">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={invitation.data.email}
                  autoComplete="username"
                  readOnly
                  className="bg-muted"
                />
              </div>
              <div className="mb-[1.1em] grid gap-[0.4em]">
                <Label htmlFor="password">新密碼</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  aria-describedby="password-hint"
                />
                <span id="password-hint" className="text-[0.84em] text-muted-foreground">
                  至少 {MIN_PASSWORD_LENGTH} 個字元。
                </span>
              </div>
              <div className="mb-[1.1em] grid gap-[0.4em]">
                <Label htmlFor="confirm">再輸入一次</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'invite-error' : undefined}
                />
              </div>
              {error && (
                <p
                  id="invite-error"
                  role="alert"
                  className="mb-[1.1em] text-[0.9em] text-destructive"
                >
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? '設定中…' : '設定密碼'}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
