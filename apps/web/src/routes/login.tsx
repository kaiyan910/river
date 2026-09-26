import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
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
  /** 密碼正確、但帳號已啟用 TOTP：還要輸入驗證器上的驗證碼（或備用碼）才會建立 session。 */
  const [challenge, setChallenge] = useState<'totp' | 'backup-code'>();

  async function signedIn() {
    // 登入頁沒有訂閱 me，invalidateQueries 只會標成 stale 而不會重抓；
    // 快取裡的 null 會讓 beforeLoad 又把人導回登入頁，所以要明確 refetch。
    await queryClient.refetchQueries({ queryKey: meQueryOptions.queryKey });
    await navigate({ to: redirectTo });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) {
      setPending(false);
      setError(error.status === 401 ? 'Email 或密碼不正確。' : '登入失敗，請稍後再試。');
      return;
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      setPending(false);
      setChallenge('totp');
      return;
    }
    await signedIn();
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '');
    setPending(true);
    setError(undefined);
    const { error } =
      challenge === 'backup-code'
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      setPending(false);
      if (
        error.code === 'INVALID_TWO_FACTOR_COOKIE' ||
        error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'
      ) {
        setChallenge(undefined);
        setError('驗證逾時或嘗試次數過多，請重新輸入密碼登入。');
        return;
      }
      setError(
        challenge === 'backup-code'
          ? '備用碼不正確或已經用過。'
          : '驗證碼不正確，請確認驗證器上的最新號碼。',
      );
      return;
    }
    await signedIn();
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
        {challenge ? (
          <form className="w-full max-w-[360px]" onSubmit={onVerify} key={challenge}>
            <div className="mb-7 flex items-center gap-2 font-bold text-[1.1em] text-primary min-[820px]:hidden">
              <Logo /> <span className="text-foreground">River</span>
            </div>
            <h1 className="mb-[0.3em] font-semibold text-[1.7em]">兩步驟驗證</h1>
            <p className="mb-[1.8em] text-muted-foreground">
              {challenge === 'totp'
                ? '輸入驗證器 app（例如 Google Authenticator）上顯示的 6 位數驗證碼。'
                : '輸入啟用兩步驟驗證時保存的其中一組備用碼；每組只能使用一次。'}
            </p>
            <div className="mb-[1.1em] grid gap-[0.4em]">
              <Label htmlFor="code">{challenge === 'totp' ? '驗證碼' : '備用碼'}</Label>
              <Input
                id="code"
                name="code"
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode={challenge === 'totp' ? 'numeric' : undefined}
                pattern={challenge === 'totp' ? '[0-9 ]{6,7}' : undefined}
                className="font-mono tracking-[0.2em]"
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
              {pending ? '驗證中…' : '驗證並登入'}
            </Button>
            <div className="mt-[1.4em] flex justify-between gap-2 text-[0.86em]">
              <button
                type="button"
                className="cursor-pointer text-primary hover:underline"
                onClick={() => {
                  setError(undefined);
                  setChallenge(challenge === 'totp' ? 'backup-code' : 'totp');
                }}
              >
                {challenge === 'totp' ? '改用備用碼' : '改用驗證器'}
              </button>
              <button
                type="button"
                className="cursor-pointer text-muted-foreground hover:underline"
                onClick={() => {
                  setError(undefined);
                  setChallenge(undefined);
                }}
              >
                回到密碼登入
              </button>
            </div>
          </form>
        ) : (
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
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">密碼</Label>
                <Link to="/forgot-password" className="text-[0.86em] text-primary hover:underline">
                  忘記密碼？
                </Link>
              </div>
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
        )}
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
