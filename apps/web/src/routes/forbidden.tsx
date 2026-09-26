import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import type { NavItem } from '@/navigation';

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
