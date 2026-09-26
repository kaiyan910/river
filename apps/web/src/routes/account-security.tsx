import { requiresTotp } from '@river/auth';
import type { MeResponse } from '@river/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Copy, ShieldAlert, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { meQueryOptions, needsTotpSetup } from '@/lib/me';
import { PERMISSION_LABELS } from '@/lib/permissions';

/** 已輸入密碼、還沒用驗證碼確認的 TOTP；只保留在這個頁面的狀態裡。 */
interface Enrollment {
  totpURI: string;
  backupCodes: string[];
}

/** 帳號安全：啟用或停用兩步驟驗證（TOTP）。橫跨清單與詳情兩欄。 */
export function AccountSecurityPage({ me }: { me: MeResponse }) {
  const sensitive = me.permissions.filter(requiresTotp);

  return (
    <section className="overflow-auto md:col-span-2">
      <div className="mx-auto grid max-w-[640px] gap-6 px-4 py-8 md:px-8">
        <header>
          <h1 className="font-semibold text-[1.4em]">帳號安全</h1>
          <p className="text-muted-foreground">
            {me.name} · {me.email}
          </p>
        </header>

        {needsTotpSetup(me) && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-status-returned/40 bg-status-returned/10 p-4"
          >
            <ShieldAlert size={20} aria-hidden className="mt-0.5 shrink-0 text-status-returned" />
            <div>
              <p className="font-medium">你必須先啟用兩步驟驗證</p>
              <p className="text-[0.93em] text-muted-foreground">
                你持有 {sensitive.map((p) => PERMISSION_LABELS[p].label).join('、')}{' '}
                Permission。這些 Permission 影響重大，完成下方的設定後才能使用。
              </p>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-[1.1em]">兩步驟驗證（TOTP）</h2>
              <p className="text-[0.93em] text-muted-foreground">
                登入時除了密碼，還要輸入手機驗證器 app（例如 Google Authenticator、1Password）上的 6
                位數驗證碼。
              </p>
            </div>
            <span
              className={
                me.twoFactorEnabled
                  ? 'inline-flex shrink-0 items-center gap-1 rounded-full bg-status-approved/15 px-2.5 py-0.5 text-[0.85em] text-status-approved'
                  : 'inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[0.85em] text-muted-foreground'
              }
            >
              {me.twoFactorEnabled && <ShieldCheck size={14} aria-hidden />}
              {me.twoFactorEnabled ? '已啟用' : '未啟用'}
            </span>
          </div>
          {me.twoFactorEnabled ? <DisableTotp sensitive={sensitive.length > 0} /> : <EnableTotp />}
        </div>
      </div>
    </section>
  );
}

/** 啟用或停用後重新取得 me，並讓路由重新執行 beforeLoad，外框與各頁面的 Permission 判斷跟著更新。 */
function useRefreshMe() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return async () => {
    await queryClient.refetchQueries({ queryKey: meQueryOptions.queryKey });
    await router.invalidate();
  };
}

function EnableTotp() {
  const refreshMe = useRefreshMe();
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password'));
    setPending(true);
    setError(undefined);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !('totpURI' in data) || !data.totpURI) {
      return setError(error?.status === 400 ? '密碼不正確。' : '無法開始設定，請稍後再試。');
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code')).replace(/\s/g, '');
    setPending(true);
    setError(undefined);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError('驗證碼不正確，請確認驗證器上的最新號碼。');
    toast('已啟用兩步驟驗證');
    await refreshMe();
  }

  if (!enrollment) {
    return (
      <form onSubmit={start} className="grid gap-3">
        <div className="grid gap-[0.4em]">
          <Label htmlFor="enable-password">輸入目前的密碼以開始設定</Label>
          <Input
            id="enable-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'enable-error' : undefined}
          />
        </div>
        {error && (
          <p id="enable-error" role="alert" className="text-[0.9em] text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="justify-self-start" disabled={pending}>
          {pending ? '準備中…' : '開始設定'}
        </Button>
      </form>
    );
  }

  const secret = new URL(enrollment.totpURI).searchParams.get('secret') ?? '';
  return (
    <div className="grid gap-5">
      <ol className="grid gap-5">
        <li className="grid gap-2">
          <p className="font-medium">1. 用驗證器 app 掃描 QR code</p>
          <div className="w-fit rounded-lg bg-white p-3">
            <QRCodeSVG value={enrollment.totpURI} size={168} title="TOTP QR code" />
          </div>
          <p className="text-[0.9em] text-muted-foreground">
            無法掃描時，改為手動輸入金鑰：
            <code className="ml-1 break-all font-mono text-foreground">{secret}</code>
          </p>
        </li>
        <li className="grid gap-2">
          <p className="font-medium">2. 保存備用碼</p>
          <p className="text-[0.9em] text-muted-foreground">
            手機遺失時可以用備用碼登入，每組只能用一次。這些備用碼只會顯示這一次。
          </p>
          <ul className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted p-3 font-mono text-[0.93em]">
            {enrollment.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              navigator.clipboard
                .writeText(enrollment.backupCodes.join('\n'))
                .then(() => toast('已複製備用碼'))
                .catch(() => toast('無法複製，請手動抄寫', 'error'))
            }
          >
            <Copy size={14} aria-hidden /> 複製備用碼
          </Button>
        </li>
        <li>
          <form onSubmit={confirm} className="grid gap-2">
            <Label htmlFor="totp-code" className="font-medium">
              3. 輸入驗證器上的 6 位數驗證碼
            </Label>
            <Input
              id="totp-code"
              name="code"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]{6,7}"
              className="max-w-[12em] font-mono tracking-[0.2em]"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'confirm-error' : undefined}
            />
            {error && (
              <p id="confirm-error" role="alert" className="text-[0.9em] text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="justify-self-start" disabled={pending}>
              {pending ? '確認中…' : '確認並啟用'}
            </Button>
          </form>
        </li>
      </ol>
    </div>
  );
}

function DisableTotp({ sensitive }: { sensitive: boolean }) {
  const refreshMe = useRefreshMe();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password'));
    setPending(true);
    setError(undefined);
    const { error } = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (error) return setError(error.status === 400 ? '密碼不正確。' : '停用失敗，請稍後再試。');
    setOpen(false);
    toast('已停用兩步驟驗證');
    await refreshMe();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        停用兩步驟驗證
      </Button>
    );
  }
  return (
    <form onSubmit={disable} className="grid gap-3">
      {sensitive && (
        <p className="text-[0.93em] text-status-returned">
          停用後，你持有的敏感 Permission 會立刻無法使用，直到重新啟用為止。
        </p>
      )}
      <div className="grid gap-[0.4em]">
        <Label htmlFor="disable-password">輸入密碼以確認停用</Label>
        <Input
          id="disable-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'disable-error' : undefined}
        />
      </div>
      {error && (
        <p id="disable-error" role="alert" className="text-[0.9em] text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? '停用中…' : '停用'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  );
}
