import { PASSWORD_RESET_EXPIRES_IN_MINUTES } from '@river/contracts';
import { Link } from '@tanstack/react-router';
import { MailCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

/** 忘記密碼：輸入 email 後寄出重設密碼信。不論帳號是否存在都顯示相同的結果，避免被用來探測帳號。 */
export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email')).trim();
    setPending(true);
    setError(undefined);
    const { error } = await authClient.requestPasswordReset({ email });
    setPending(false);
    if (error) return setError('寄送失敗，請稍後再試。');
    setSentTo(email);
  }

  return (
    <AuthLayout
      tagline={
        <>
          忘記密碼了嗎？
          <br />用 email 重新設定。
        </>
      }
    >
      {sentTo ? (
        <>
          <MailCheck size={32} aria-hidden className="mb-3 text-status-approved" />
          <h1 className="mb-2 font-semibold text-[1.6em]">請查看信箱</h1>
          <p className="mb-6 text-muted-foreground">
            如果 {sentTo} 是 River 的帳號，你會收到一封重設密碼信。請在{' '}
            {PASSWORD_RESET_EXPIRES_IN_MINUTES} 分鐘內點信裡的連結設定新密碼。
          </p>
          <Link to="/login" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
            回到登入
          </Link>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <h1 className="mb-[0.3em] font-semibold text-[1.7em]">忘記密碼</h1>
          <p className="mb-[1.8em] text-muted-foreground">
            輸入你的公司 email，我們會寄一封重設密碼信給你。
          </p>
          <div className="mb-[1.1em] grid gap-[0.4em]">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'forgot-error' : undefined}
            />
          </div>
          {error && (
            <p id="forgot-error" role="alert" className="mb-[1.1em] text-[0.9em] text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? '寄送中…' : '寄出重設密碼信'}
          </Button>
          <p className="mt-[1.4em] text-[0.86em]">
            <Link to="/login" className="text-primary hover:underline">
              回到登入
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
