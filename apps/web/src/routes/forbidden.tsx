import { Link } from '@tanstack/react-router';
import { Lock, ShieldAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ACCOUNT_SECURITY_PATH, type NavItem } from '@/navigation';

/** 直接開啟沒有 Permission 的頁面時顯示；導覽列本來就不會出現這些項目。 */
export function ForbiddenPage({ item }: { item: NavItem }) {
  return (
    <section className="overflow-auto md:col-span-2">
      <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
          <Lock size={26} aria-hidden />
        </div>
        <h1 className="font-semibold text-[1.3em]">沒有權限查看「{item.label}」</h1>
        <p className="max-w-[36em] text-muted-foreground">
          需要{' '}
          <code className="font-mono">
            {typeof item.requires === 'string' ? item.requires : item.requires?.join(' 或 ')}
          </code>{' '}
          Permission。如果你需要這個功能，請聯絡 Administrator。
        </p>
        <Link to="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          回到首頁
        </Link>
      </div>
    </section>
  );
}

/** 持有這個頁面需要的 Permission，但那是需要 TOTP 的 Permission 而還沒啟用：引導去設定。 */
export function TotpRequiredPage({ item }: { item: NavItem }) {
  return (
    <section className="overflow-auto md:col-span-2">
      <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-status-returned">
          <ShieldAlert size={26} aria-hidden />
        </div>
        <h1 className="font-semibold text-[1.3em]">使用「{item.label}」前，請先啟用兩步驟驗證</h1>
        <p className="max-w-[36em] text-muted-foreground">
          這個功能需要的 Permission
          影響重大，持有的人必須啟用兩步驟驗證（TOTP）才能使用。設定只需要一支裝有驗證器 app
          的手機，約一分鐘即可完成。
        </p>
        <Link to={ACCOUNT_SECURITY_PATH} className={buttonVariants({ size: 'sm' })}>
          前往設定兩步驟驗證
        </Link>
      </div>
    </section>
  );
}
