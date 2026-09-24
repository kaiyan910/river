import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Inbox, List, Shield } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { meQueryOptions } from '@/lib/me';

/** 登入頁：A「清流」的分割式版面，左側品牌色塊、右側表單；窄螢幕只留表單。 */
export function LoginPage({ redirectTo }: { redirectTo: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    const { error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) {
      setPending(false);
      setError(error.status === 401 ? 'Email 或密碼不正確。' : '登入失敗，請稍後再試。');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
    await navigate({ to: redirectTo });
  }

  return (
    <div className="grid min-h-screen min-[820px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between gap-10 overflow-hidden bg-brand px-12 py-10 text-brand-foreground min-[820px]:flex">
        <div className="relative flex items-center gap-2 font-bold text-[1.1em]">
          <Logo /> River
        </div>
        <div className="relative">
          <h2 className="mb-[1em] font-semibold text-[2em] tracking-[-0.02em]">
            申請、審批、追蹤進度，
            <br />
            都在同一個地方。
          </h2>
          <ul className="grid gap-[0.8em] opacity-90">
            <li className="flex items-center gap-2.5">
              <Inbox size={18} aria-hidden /> 所有待辦集中在一個清單
            </li>
            <li className="flex items-center gap-2.5">
              <List size={18} aria-hidden /> 隨時知道申請卡在哪一步
            </li>
            <li className="flex items-center gap-2.5">
              <Shield size={18} aria-hidden /> 敏感資料只在平台內可見
            </li>
          </ul>
        </div>
        <p className="relative text-[0.86em] opacity-65">公司內部系統 · 僅限員工使用</p>
        <Waves />
      </aside>

      <main className="grid place-items-center px-4 pt-8 pb-16">
        <form className="w-full max-w-[360px]" onSubmit={onSubmit}>
          <div className="mb-7 flex items-center gap-2 font-bold text-[1.1em] text-primary min-[820px]:hidden">
            <Logo /> <span className="text-foreground">River</span>
          </div>
          <h1 className="mb-[0.3em] font-semibold text-[1.7em]">登入</h1>
          <p className="mb-[1.8em] text-muted-foreground">使用公司 email 與密碼登入。</p>

          <div className="mb-[1.1em] grid gap-[0.4em]">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <div className="mb-[1.1em] grid gap-[0.4em]">
            <Label htmlFor="password">密碼</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          {error && (
            <p id="login-error" role="alert" className="mb-[1.1em] text-[0.9em] text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? '登入中…' : '登入'}
          </Button>
          <p className="mt-[1.4em] text-[0.86em] text-muted-foreground">
            帳號由 Administrator 建立。還沒收到邀請信？請聯絡 IT。
          </p>
        </form>
      </main>
    </div>
  );
}

function Waves() {
  return (
    <svg
      className="pointer-events-none absolute right-[-10%] bottom-[-20px] left-[-10%] opacity-[0.13]"
      viewBox="0 0 720 240"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      {Array.from({ length: 7 }, (_, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: 固定數量的裝飾線條
          key={i}
          d={`M0 ${40 + i * 26}c80-30 160 30 240 0s160-30 240 0 160 30 240 0`}
        />
      ))}
    </svg>
  );
}
