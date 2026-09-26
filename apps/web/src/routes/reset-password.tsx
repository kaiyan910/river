import { Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

const MIN_PASSWORD_LENGTH = 12;

/** 重設密碼信連結的落地頁：設定新密碼；成功後其他裝置上的登入全部失效。 */
export function ResetPasswordPage({ token }: { token: string }) {
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
          ? '重設密碼連結已失效（超過有效時間或已經使用過），請重新申請。'
          : '重設密碼失敗，請稍後再試。',
      );
      return;
    }
    setDone(true);
  }

  return (
    <AuthLayout
      tagline={
        <>
          設定新密碼，
          <br />
          就能重新登入。
        </>
      }
    >
      {done ? (
        <>
          <CircleCheck size={32} aria-hidden className="mb-3 text-status-approved" />
          <h1 className="mb-2 font-semibold text-[1.6em]">密碼已重設</h1>
          <p className="mb-6 text-muted-foreground">其他裝置上的登入都已登出。請用新密碼登入。</p>
          <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
            前往登入
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <h1 className="mb-[0.3em] font-semibold text-[1.7em]">重設密碼</h1>
          <p className="mb-[1.8em] text-muted-foreground">設定一組新的密碼。</p>
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
              aria-describedby={error ? 'reset-error' : undefined}
            />
          </div>
          {error && (
            <p id="reset-error" role="alert" className="mb-[1.1em] text-[0.9em] text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? '設定中…' : '設定新密碼'}
          </Button>
          <p className="mt-[1.4em] text-[0.86em]">
            <Link to="/forgot-password" className="text-primary hover:underline">
              重新申請重設密碼信
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
